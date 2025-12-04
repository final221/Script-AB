// --- Pattern Discovery ---
/**
 * Discovers new ad patterns for future blocking.
 * Enhanced to capture more Twitch-specific URLs for pattern updates.
 */
const PatternDiscovery = (() => {
    // Track unknown suspicious URLs
    const _suspiciousUrls = new Set();
    const _allTwitchUrls = new Set(); // Track ALL Twitch-related URLs for analysis
    const MAX_CAPTURED_URLS = 500; // Limit memory usage

    // Keywords that might indicate ad-related content
    const _suspiciousKeywords = [
        'ad', 'ads', 'advertisement', 'preroll', 'midroll',
        'doubleclick', 'pubads', 'vast', 'tracking', 'analytics',
        'sponsor', 'commercial', 'promo'
    ];

    // Twitch-specific patterns to always capture for analysis
    const _twitchCapturePatterns = [
        'usher', 'ttvnw', 'video-weaver', 'video-edge',
        '.m3u8', 'segment', 'chunked'
    ];

    /**
     * Classifies URL type for better analysis
     * @param {string} url - URL to classify
     * @returns {string} URL category
     */
    const classifyUrl = (url) => {
        const urlLower = url.toLowerCase();
        if (urlLower.includes('.m3u8') || urlLower.includes('segment')) return 'video';
        if (urlLower.includes('tracking') || urlLower.includes('analytics')) return 'tracking';
        if (_suspiciousKeywords.some(k => urlLower.includes(k))) return 'ads';
        if (urlLower.includes('gql') || urlLower.includes('graphql')) return 'graphql';
        return 'other';
    };

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

        // Capture ALL Twitch-related URLs when below limit
        const isTwitchRelated = urlLower.includes('twitch') || urlLower.includes('ttvnw');
        const hasCapturePattern = _twitchCapturePatterns.some(p => urlLower.includes(p));

        if ((isTwitchRelated || hasCapturePattern) && _allTwitchUrls.size < MAX_CAPTURED_URLS) {
            _allTwitchUrls.add(url);
        }

        // Check if URL contains suspicious keywords
        const hasSuspiciousKeyword = _suspiciousKeywords.some(keyword =>
            urlLower.includes(keyword)
        );

        if (hasSuspiciousKeyword && !_suspiciousUrls.has(url)) {
            _suspiciousUrls.add(url);
            const category = classifyUrl(url);

            // ✅ This gets exported with exportTwitchAdLogs()
            Logger.add('[PATTERN DISCOVERY] Suspicious URL detected', {
                url,
                category,
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

    /**
     * Exports ALL captured Twitch URLs for comprehensive analysis
     * @returns {{suspicious: string[], allTwitch: string[], stats: Object}}
     */
    const exportCapturedUrls = () => {
        const suspicious = Array.from(_suspiciousUrls);
        const allTwitch = Array.from(_allTwitchUrls);

        return {
            suspicious,
            allTwitch,
            stats: {
                suspiciousCount: suspicious.length,
                totalCaptured: allTwitch.length,
                maxCapture: MAX_CAPTURED_URLS,
                atLimit: allTwitch.length >= MAX_CAPTURED_URLS
            }
        };
    };

    /**
     * Clears captured URLs (useful for fresh capture sessions)
     */
    const clearCaptured = () => {
        _suspiciousUrls.clear();
        _allTwitchUrls.clear();
        Logger.add('[PATTERN DISCOVERY] Cleared captured URLs for fresh session');
    };

    return {
        detectNewPatterns,
        getDiscoveredPatterns,
        exportCapturedUrls,
        clearCaptured
    };
})();
