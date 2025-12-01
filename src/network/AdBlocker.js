// --- AdBlocker ---
/**
 * Handles the decision logic for detecting ads and triggers.
 * @responsibility
 * 1. Check URLs against ad patterns.
 * 2. Emit AD_DETECTED only for actual ad delivery (not availability checks).
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
    const process = (url, type) => {
        // 1. Input Validation
        if (!url || typeof url !== 'string') {
            Logger.debug('[NETWORK] Invalid URL passed to AdBlocker', { url, type });
            return false;
        }

        let isAd = false;
        let isTrigger = false;

        // 2. Check Trigger First (Subset of Ads)
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
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'NETWORK',
                    trigger: 'AD_DELIVERY',
                    reason: 'Ad delivery pattern matched',
                    details: { url, type }
                });
            }
        }
        // 3. Check Generic Ad (if not already identified as trigger)
        else if (Logic.Network.isAd(url)) {
            isAd = true;
            Logger.add('[NETWORK] Ad pattern detected', { type, url });
        }

        // 4. Unified Metrics
        if (isAd) {
            Metrics.increment('ads_detected');
        }

        return isAd;
    };

    return {
        process
    };
})();
