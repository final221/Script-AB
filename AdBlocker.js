// --- AdBlocker ---
/**
 * Handles the decision logic for detecting ads and triggers.
 * @responsibility
 * 1. Check URLs against ad patterns.
 * 2. Emit AD_DETECTED events.
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
    const process = (url, type) => {
        if (Logic.Network.isTrigger(url)) {
            Logger.add('Trigger pattern detected', { type, url });
            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
        }
        const isAd = Logic.Network.isAd(url);
        if (isAd) {
            Logger.add('Ad pattern detected', { type, url });
            Metrics.increment('ads_detected');
        }
        return isAd;
    };

    return {
        process
    };
})();
