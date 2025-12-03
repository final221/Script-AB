// --- Ad Detection ---
/**
 * Ad detection logic for network requests.
 */
const AdDetection = (() => {
    /**
     * Checks if URL matches ad blocking patterns
     * @param {string} url - URL to check
     * @returns {boolean} True if URL should be blocked as ad
     */
    const isAd = (url) => {
        if (!url || typeof url !== 'string') return false;
        return CONFIG.regex.AD_BLOCK.test(url);
    };

    /**
     * Checks if URL matches ad trigger patterns
     * @param {string} url - URL to check
     * @returns {boolean} True if URL triggers ad detection
     */
    const isTrigger = (url) => {
        if (!url || typeof url !== 'string') return false;
        return CONFIG.regex.AD_TRIGGER.test(url);
    };

    /**
     * Checks if URL is an ad delivery request (not just availability check)
     * @param {string} url - URL to check
     * @returns {boolean} True if URL is delivering ad content
     */
    const isDelivery = (url) => {
        if (!url || typeof url !== 'string') return false;

        // Check delivery patterns against pathname only
        const hasDelivery = CONFIG.network.DELIVERY_PATTERNS.some(p =>
            UrlParser.pathMatches(url, p)
        );

        // Ensure it's NOT just an availability check
        const isAvailability = CONFIG.network.AVAILABILITY_PATTERNS.some(p => {
            const parsed = UrlParser.parseUrl(url);
            if (parsed) {
                // For query param patterns (bp=preroll), check search params
                if (p.includes('=')) {
                    return parsed.search.includes(p);
                }
                // For path patterns, check pathname
                return parsed.pathname.includes(p);
            }
            return url.includes(p);
        });

        return hasDelivery && !isAvailability;
    };

    /**
     * Checks if URL is an ad availability check (not actual delivery)
     * @param {string} url - URL to check
     * @returns {boolean} True if URL is checking ad availability
     */
    const isAvailabilityCheck = (url) => {
        if (!url || typeof url !== 'string') return false;

        return CONFIG.network.AVAILABILITY_PATTERNS.some(p => {
            const parsed = UrlParser.parseUrl(url);
            if (parsed) {
                // Query param patterns
                if (p.includes('=')) {
                    return parsed.search.includes(p);
                }
                // Path patterns
                return parsed.pathname.includes(p);
            }
            return url.includes(p);
        });
    };

    return {
        isAd,
        isTrigger,
        isDelivery,
        isAvailabilityCheck
    };
})();
