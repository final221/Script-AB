// --- URL Parser ---
/**
 * Safe URL parsing utilities with fallback handling.
 */
const UrlParser = (() => {
    /**
     * Safely parses a URL with fallback for relative URLs
     * @param {string} url - URL to parse
     * @returns {URL|null} Parsed URL or null if parsing fails
     */
    const parseUrl = (url) => {
        try {
            return new URL(url);
        } catch (e) {
            // Fallback for relative URLs (e.g. "/ad/v1/")
            try {
                return new URL(url, 'http://twitch.tv');
            } catch (e2) {
                // Fallback for truly malformed input
                Logger.add('[Logic] URL parse failed, using string matching', { url, error: String(e2) });
                return null;
            }
        }
    };

    /**
     * Checks if pattern matches URL pathname (not query/hash)
     * @param {string} url - URL to check
     * @param {string} pattern - Pattern to match against pathname
     * @returns {boolean} True if pathname contains pattern
     */
    const pathMatches = (url, pattern) => {
        const parsed = parseUrl(url);
        if (parsed) {
            // Match against pathname only (ignore query and hash)
            return parsed.pathname.includes(pattern);
        }
        // Fallback: use string matching on full URL
        return url.includes(pattern);
    };

    return {
        parseUrl,
        pathMatches
    };
})();
