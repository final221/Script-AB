// --- Diagnostics ---
/**
 * Handles network traffic logging and diagnostics.
 * @responsibility
 * 1. Log network requests based on sampling/relevance.
 */
const Diagnostics = (() => {
    const logNetworkRequest = (url, type, isAd) => {
        if (isAd) return;

        // --- START OF DIAGNOSTIC CHANGE ---
        // Temporarily increase logging to find new ad patterns.
        const isRelevant = url.includes('twitch') || url.includes('ttvnw') || url.includes('.m3u8');

        if (isRelevant && Math.random() < 0.25) { // Log 25% of relevant requests
            Logger.add('Network Request (DIAGNOSTIC)', { type, url });
        }
        // --- END OF DIAGNOSTIC CHANGE ---
    };

    return {
        logNetworkRequest
    };
})();
