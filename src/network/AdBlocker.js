// --- AdBlocker ---
/**
 * Handles the decision logic for detecting ads and triggers.
 * @responsibility
 * 1. Check URLs against ad patterns.
 * 2. Emit AD_DETECTED only for actual ad delivery (not availability checks).
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
    // Correlation tracking
    let lastAdDetectionTime = 0; // Kept for local fallback/legacy support

    const process = (url, type) => {
        // 1. Input Validation
        if (!url || typeof url !== 'string') {
            Logger.debug('[NETWORK] Invalid URL passed to AdBlocker', { url, type });
            return false;
        }

        // 2. Pattern Discovery (Always run)
        Logic.Network.detectNewPatterns(url);

        let isAd = false;
        let isTrigger = false;

        // 3. Check Trigger First (Subset of Ads)
        if (Logic.Network.isTrigger(url)) {
            isTrigger = true;
            isAd = true; // Triggers are always ads

            const isDelivery = Logic.Network.isDelivery(url);
            const triggerCategory = isDelivery ? 'Ad Delivery' : 'Availability Check';

            Logger.add(`[NETWORK] Trigger pattern detected | Category: ${triggerCategory}`, {
                type,
                url,
                isDelivery
            });

            // Only emit AD_DETECTED for actual ad delivery
            if (isDelivery) {
                if (typeof AdAnalytics !== 'undefined') {
                    AdAnalytics.trackDetection();
                }
                lastAdDetectionTime = Date.now();

                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'NETWORK',
                    trigger: 'AD_DELIVERY',
                    reason: 'Ad delivery pattern matched',
                    details: { url, type }
                });
            }
        }
        // 4. Check Generic Ad (if not already identified as trigger)
        else if (Logic.Network.isAd(url)) {
            isAd = true;
            Logger.add('[NETWORK] Ad pattern detected', { type, url });
        }

        // 5. Unified Metrics
        if (isAd) {
            Metrics.increment('ads_detected');

            // NEW: Record for correlation tracking
            if (typeof AdCorrelation !== 'undefined') {
                AdCorrelation.recordBlock(url, type);
            }
        }

        return isAd;
    };

    // Listen for health-triggered recoveries to detect missed ads
    const initCorrelationTracking = () => {
        if (typeof AdAnalytics !== 'undefined') {
            AdAnalytics.init();
        } else {
            Logger.debug('[NETWORK] AdAnalytics module not loaded, skipping correlation tracking');
        }
    };

    return {
        process,
        init: initCorrelationTracking,

        // Delegate stats to AdAnalytics if available
        getCorrelationStats: () => {
            if (typeof AdAnalytics !== 'undefined') {
                return AdAnalytics.getCorrelationStats();
            }
            return { error: 'AdAnalytics not loaded' };
        }
    };
})();
