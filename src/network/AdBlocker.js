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
    let lastAdDetectionTime = 0;
    let recoveryTriggersWithoutAds = 0;

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
        }

        return isAd;
    };

    // Listen for health-triggered recoveries to detect missed ads
    const initCorrelationTracking = () => {
        Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
            if (payload.source === 'HEALTH') {
                // Health monitor triggered recovery
                const timeSinceLastAd = Date.now() - lastAdDetectionTime;

                // If > 10 seconds since last network detection, could be a missed ad
                if (timeSinceLastAd > 10000) {
                    recoveryTriggersWithoutAds++;

                    Logger.add('[CORRELATION] Recovery triggered without recent ad detection', {
                        trigger: payload.trigger,
                        reason: payload.reason,
                        timeSinceLastNetworkAd: (timeSinceLastAd / 1000).toFixed(1) + 's',
                        totalMissedCount: recoveryTriggersWithoutAds,
                        suggestion: 'Possible missed ad pattern or legitimate stuck state'
                    });
                }
            }
        });
    };

    return {
        process,
        init: initCorrelationTracking,

        // Get correlation stats
        getCorrelationStats: () => ({
            lastAdDetectionTime,
            recoveryTriggersWithoutAds,
            ratio: recoveryTriggersWithoutAds > 0 ?
                recoveryTriggersWithoutAds / (Metrics.get('ads_detected') || 1) : 0
        })
    };
})();
