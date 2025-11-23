// --- AdBlocker ---
/**
 * Handles the decision logic for detecting ads and triggers.
 * @responsibility
 * 1. Check URLs against ad patterns.
 * 2. Emit AD_DETECTED only for actual ad delivery (not availability checks).
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
    const isActualAdDelivery = (url) => {
        // Actual ad delivery patterns (not just availability checks)
        const deliveryPatterns = [
            '/ad_state/',           // Ad state changes (actual injection)
            'vod_ad_manifest',      // VOD ad manifest (actual ad)
            '/usher/v1/ad/',        // Ad serving endpoint (some cases)
        ];

        // Availability check patterns (don't trigger recovery)
        const availabilityPatterns = [
            '/3p/ads?',             // Third-party ad availability check
            'bp=preroll',           // Preroll check parameter
            'bp=midroll',           // Midroll check parameter
        ];

        // If it's just an availability check, don't treat as delivery
        if (availabilityPatterns.some(pattern => url.includes(pattern))) {
            return false;
        }

        // Otherwise check if it matches delivery patterns
        return deliveryPatterns.some(pattern => url.includes(pattern));
    };

    const process = (url, type) => {
        const isTrigger = Logic.Network.isTrigger(url);
        const isDelivery = isActualAdDelivery(url);

        if (isTrigger) {
            Logger.add('Trigger pattern detected', {
                type,
                url,
                isAvailabilityCheck: !isDelivery
            });

            // Only emit AD_DETECTED for actual ad delivery
            if (isDelivery) {
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
            }
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
