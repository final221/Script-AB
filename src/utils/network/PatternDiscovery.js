// --- Pattern Discovery ---
/**
 * Discovers new ad patterns for future blocking.
 */
const PatternDiscovery = (() => {
    // Track unknown suspicious URLs
    const _suspiciousUrls = new Set();
    const _suspiciousKeywords = [
        'ad', 'ads', 'advertisement', 'preroll', 'midroll',
        'doubleclick', 'pubads', 'vast', 'tracking', 'analytics'
    ];

    /**
     * Detects potentially new ad patterns
     * Logs URLs that look like ads but don't match existing patterns
     * @param {string} url - URL to analyze
     */
    const detectNewPatterns = (url) => {
        if (!url || typeof url !== 'string') return;

        // Skip if already matches known patterns
        if (AdDetection.isAd(url)) return;
        if (AdDetection.isTrigger(url)) return;

        const urlLower = url.toLowerCase();
        const parsed = UrlParser.parseUrl(url);

        // Check if URL contains suspicious keywords
        const hasSuspiciousKeyword = _suspiciousKeywords.some(keyword =>
            urlLower.includes(keyword)
        );

        if (hasSuspiciousKeyword && !_suspiciousUrls.has(url)) {
            _suspiciousUrls.add(url);

            // ✅ This gets exported with exportTwitchAdLogs()
            Logger.add('[PATTERN DISCOVERY] Suspicious URL detected', {
                url,
                pathname: parsed ? parsed.pathname : 'parse failed',
                hostname: parsed ? parsed.hostname : 'parse failed',
                keywords: _suspiciousKeywords.filter(k => urlLower.includes(k)),
                suggestion: 'Review this URL - might be a new ad pattern'
            });
        }
    };

    /**
     * Exports discovered patterns for review
     * @returns {string[]} Array of discovered suspicious URLs
     */
    const getDiscoveredPatterns = () => Array.from(_suspiciousUrls);

    return {
        detectNewPatterns,
        getDiscoveredPatterns
    };
})();
