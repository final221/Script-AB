// --- Pattern Discovery ---
/**
 * Discovers new ad patterns for future blocking.
 * Enhanced to capture more Twitch-specific URLs for pattern updates.
 */
const PatternDiscovery = (() => {
    // Track unknown suspicious URLs
    const _suspiciousUrls = new Set();
    const _allTwitchUrls = new Set(); // Track ALL Twitch-related URLs for analysis
    const MAX_CAPTURED_URLS = 1000; // Increased limit for better discovery

    // BROAD keywords that might indicate ad-related content
    const _suspiciousKeywords = [
        // Core ad terms
        'ad', 'ads', 'adv', 'advertisement', 'advertising',
        // Roll types
        'preroll', 'midroll', 'postroll', 'roll',
        // Ad networks
        'doubleclick', 'pubads', 'adsystem', 'adserver', 'adservice',
        'googlesyndication', 'googleads', 'amazon-adsystem',
        // Tracking
        'vast', 'vpaid', 'vmap', 'tracking', 'analytics', 'telemetry',
        'beacon', 'pixel', 'impression', 'viewability',
        // Commercial terms
        'sponsor', 'commercial', 'promo', 'promotion', 'monetiz',
        // Video ad specific
        'video-ad', 'videoad', 'instream', 'outstream',
        // IMA SDK
        'imasdk', 'ima3', 'ima/',
        // Targeting
        'targeting', 'personali', 'segment',
        // Revenue
        'revenue', 'monetization', 'bid', 'auction',
        // Player injection
        'overlay', 'companion', 'banner',
        // Twitch-specific suspects
        'supervisor', 'ext-twitch', 'spade', 'countess'
    ];

    // Twitch-specific patterns to always capture for analysis
    const _twitchCapturePatterns = [
        'usher', 'ttvnw', 'video-weaver', 'video-edge',
        '.m3u8', 'segment', 'chunked', 'playlist',
        'gql', 'graphql', 'api.twitch', 'pubsub',
        'spade', 'countess', 'supervisor', 'ext-twitch',
        'clips.twitch', 'vod-secure', 'vod-metro'
    ];

    // FUZZY regex patterns for catching variations like ad-server, ads_123, etc.
    const _fuzzyPatterns = [
        /[\/\.\-_]ads?[\/\.\-_\d]/i,      // /ad/, .ad., -ad-, _ad_, /ads/, ad1, etc.
        /[\/\.\-_]adv[\/\.\-_]/i,         // /adv/, .adv.
        /commercial[s]?[\/\.\-_]/i,       // commercials/, commercial-
        /sponsor[s]?[\/\.\-_]/i,          // sponsors/, sponsor-
        /promo(tion)?[s]?[\/\.\-_]/i,     // promo/, promotion/, promos/
        /track(ing|er)?[\/\.\-_]/i,       // track/, tracking/, tracker/
        /beacon[\/\.\-_]/i,               // beacon/
        /pixel[\/\.\-_\d]/i,              // pixel/, pixel1
        /\/(pre|mid|post)roll/i,          // /preroll, /midroll, /postroll
        /video[\-_]?ad/i,                 // video-ad, video_ad, videoad
        /ad[\-_]?server/i,                // ad-server, ad_server, adserver
        /ad[\-_]?network/i,               // ad-network, adnetwork
        /monetiz/i,                       // monetize, monetization
        /\.bid\./i,                       // .bid. (bidding)
        /auction[\/\.\-_]/i,              // auction/
    ];

    /**
     * Checks if URL matches any fuzzy pattern
     * @param {string} url - URL to check
     * @returns {boolean} True if matches fuzzy pattern
     */
    const matchesFuzzy = (url) => {
        return _fuzzyPatterns.some(regex => regex.test(url));
    };

    /**
     * Classifies URL type for better analysis
     * @param {string} url - URL to classify
     * @returns {string} URL category
     */
    const classifyUrl = (url) => {
        const urlLower = url.toLowerCase();
        if (urlLower.includes('.m3u8') || urlLower.includes('segment')) return 'video';
        if (urlLower.includes('tracking') || urlLower.includes('analytics')) return 'tracking';
        if (_suspiciousKeywords.some(k => urlLower.includes(k))) return 'ads-keyword';
        if (matchesFuzzy(url)) return 'ads-fuzzy';
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

        // Check if URL contains suspicious keywords OR matches fuzzy patterns
        const hasSuspiciousKeyword = _suspiciousKeywords.some(keyword =>
            urlLower.includes(keyword)
        );
        const hasFuzzyMatch = matchesFuzzy(url);

        if ((hasSuspiciousKeyword || hasFuzzyMatch) && !_suspiciousUrls.has(url)) {
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
     * Also logs summary to be visible in exportTwitchAdLogs()
     * @returns {{suspicious: string[], allTwitch: string[], stats: Object}}
     */
    const exportCapturedUrls = () => {
        const suspicious = Array.from(_suspiciousUrls);
        const allTwitch = Array.from(_allTwitchUrls);

        const result = {
            suspicious,
            allTwitch,
            stats: {
                suspiciousCount: suspicious.length,
                totalCaptured: allTwitch.length,
                maxCapture: MAX_CAPTURED_URLS,
                atLimit: allTwitch.length >= MAX_CAPTURED_URLS
            }
        };

        // Log summary to make it visible in exportTwitchAdLogs()
        Logger.add('[PATTERN DISCOVERY] URL Capture Export', {
            suspiciousCount: result.stats.suspiciousCount,
            totalCaptured: result.stats.totalCaptured,
            atLimit: result.stats.atLimit,
            suspiciousSample: suspicious.slice(0, 10), // First 10 for log brevity
            hint: 'Full data returned in console'
        });

        return result;
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
