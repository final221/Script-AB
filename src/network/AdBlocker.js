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
        const isTrigger = Logic.Network.isTrigger(url);
        const isDelivery = Logic.Network.isDelivery(url);

        if (isTrigger) {
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

        const isAd = Logic.Network.isAd(url);
        if (isAd) {
            Logger.add('[NETWORK] Ad pattern detected', { type, url });
            Metrics.increment('ads_detected');
        }
        return isAd;
    };

    return {
        process
    };
})();
