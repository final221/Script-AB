// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       3.0.4
// @description   🛡️ Stealth Reactor Core: Blocks Twitch ads with self-healing.
// @author        Senior Expert AI
// @match         *://*.twitch.tv/*
// @run-at        document-start
// @grant         none
// ==/UserScript==

(function () {
    'use strict';

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================
/**
 * Central configuration object.
 * @typedef {Object} Config
 * @property {boolean} debug - Toggles console logging.
 * @property {Object} selectors - DOM selectors for player elements.
 * @property {Object} timing - Timeouts and delays (in ms).
 * @property {Object} network - URL patterns for ad detection.
 * @property {Object} mock - Mock response bodies for blocked requests.
 */
const CONFIG = (() => {
    const raw = {
        debug: false,
        selectors: {
            PLAYER: '.video-player',
            VIDEO: 'video',
        },
        timing: {
            RETRY_MS: 1000,
            INJECTION_MS: 50,
            HEALTH_CHECK_MS: 1000,
            HEALTH_COOLDOWN_MS: 5000,
            LOG_THROTTLE: 5,
            LOG_EXPIRY_MIN: 5,
            REVERSION_DELAY_MS: 100,
            FORCE_PLAY_DEFER_MS: 1,
            REATTEMPT_DELAY_MS: 60 * 1000,
            PLAYBACK_TIMEOUT_MS: 2500,
            FRAME_DROP_SEVERE_THRESHOLD: 500,
            FRAME_DROP_MODERATE_THRESHOLD: 100,
            FRAME_DROP_RATE_THRESHOLD: 30,
            AV_SYNC_THRESHOLD_MS: 250, // Detection threshold - log all desyncs for visibility
            AV_SYNC_CHECK_INTERVAL_MS: 3000, // Check every 3s (reduced frequency)
            AV_SYNC_RECOVERY_THRESHOLD_MS: 2000, // Only trigger recovery for severe desync
            AV_SYNC_CRITICAL_THRESHOLD_MS: 5000, // Only reload stream for critical desync
        },
        logging: {
            NETWORK_SAMPLE_RATE: 0.05,
            LOG_CSP_WARNINGS: true,
            LOG_NORMAL_NETWORK: false,
        },
        network: {
            AD_PATTERNS: ['/ad/v1/', '/usher/v1/ad/', '/api/v5/ads/', 'pubads.g.doubleclick.net', 'supervisor.ext-twitch.tv', '/3p/ads'],
            TRIGGER_PATTERNS: ['/ad_state/', 'vod_ad_manifest'],

            // NEW: Fuzzy patterns to catch ad URL variations
            AD_PATTERN_REGEX: [
                /\/ad[s]?\//i,           // /ad/, /ads/, /Ad/, etc.
                /\/advertis/i,           // /advertisement/, /advertising/
                /preroll|midroll/i,      // Common ad types in path/query
                /doubleclick/i,          // Google ads
                /\.ad\./i,               // *.ad.* domains
            ],

            // Structured patterns with type info
            DELIVERY_PATTERNS_TYPED: [
                { pattern: '/ad_state/', type: 'path' },
                { pattern: 'vod_ad_manifest', type: 'path' },
                { pattern: '/usher/v1/ad/', type: 'path' }
            ],

            AVAILABILITY_PATTERNS_TYPED: [
                { pattern: '/3p/ads', type: 'path' },
                { pattern: 'bp=preroll', type: 'query' },
                { pattern: 'bp=midroll', type: 'query' }
            ],

            // Backwards compatibility
            get DELIVERY_PATTERNS() {
                return this.DELIVERY_PATTERNS_TYPED.map(p => p.pattern);
            },
            get AVAILABILITY_PATTERNS() {
                return this.AVAILABILITY_PATTERNS_TYPED.map(p => p.pattern);
            }
        },
        mock: {
            M3U8: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n',
            JSON: '{"data":[]}',
            VAST: '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"><Ad><InLine><AdSystem>Twitch</AdSystem><AdTitle>Ad</AdTitle><Creatives></Creatives></InLine></Ad></VAST>'
        },
        player: {
            MAX_SEARCH_DEPTH: 15,
            // INCREASED: More tolerant stuck detection (was 0.1s / 2 checks)
            // Now: 0.5s movement threshold, 5 consecutive checks = 5+ seconds stuck
            STUCK_THRESHOLD_S: 0.5,    // Was 0.1 - now 5x more tolerant
            STUCK_COUNT_LIMIT: 5,      // Was 2 - needs 5 consecutive failed checks
            STANDARD_SEEK_BACK_S: 3.5,
            BLOB_SEEK_BACK_S: 3,
            BUFFER_HEALTH_S: 5,
        },
        // Plan B: Experimental features
        experimental: {
            ENABLE_LIVE_PATTERNS: true,     // Fetch patterns from external sources
            ENABLE_PLAYER_PATCHING: false,  // Hook into player internals (risky)
        },
        codes: {
            MEDIA_ERROR_SRC: 4,
        },
    };

    return Object.freeze({
        ...raw,
        events: {
            AD_DETECTED: 'AD_DETECTED',
            ACQUIRE: 'ACQUIRE',
            REPORT: 'REPORT',
            LOG: 'LOG',
        },
        regex: {
            AD_BLOCK: new RegExp(raw.network.AD_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('|')),
            AD_TRIGGER: new RegExp(raw.network.AD_PATTERNS.concat(raw.network.TRIGGER_PATTERNS).map(p => p.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('|')),
        }
    });
})();

// ============================================================================
// 2. FUNCTIONAL UTILITIES
// ============================================================================
/**
 * Pure utility functions for functional composition and async handling.
 * @namespace Fn
 */
const Fn = {
    pipe: (...fns) => (x) => fns.reduce((v, f) => f(v), x),

    tryCatch: (fn, fallback) => (...args) => {
        try { return fn(...args); } catch (e) { return fallback ? fallback(e) : null; }
    },

    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    debounce: (func, delay) => {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                try {
                    func.apply(this, args);
                } catch (error) {
                    Logger.add('Debounce error', {
                        function: func.name || 'anonymous',
                        error: error.message,
                        stack: error.stack
                    });
                }
            }, delay);
        };
    }
};

// ============================================================================
// 3. ADAPTERS (Side-Effects)
// ============================================================================
/**
 * Side-effect wrappers for DOM, Storage, and Event handling.
 * Isolate impure operations here to keep Logic kernels pure.
 * @namespace Adapters
 */
const Adapters = {
    DOM: {
        find: (sel) => document.querySelector(sel),
        clone: (el) => el.cloneNode(true),
        replace: (oldEl, newEl) => oldEl.parentNode && oldEl.parentNode.replaceChild(newEl, oldEl),
        observe: (el, cb, opts) => {
            const obs = new MutationObserver(cb);
            obs.observe(el, opts);
            return obs;
        }
    },
    Storage: {
        read: (key) => Fn.tryCatch(() => localStorage.getItem(key))(),
        write: (key, val) => Fn.tryCatch(() => localStorage.setItem(key, JSON.stringify(val)))(),
    },
    EventBus: {
        listeners: {},
        on(event, callback) {
            if (!this.listeners[event]) this.listeners[event] = new Set();
            this.listeners[event].add(callback);
        },
        emit(event, data) {
            if (!this.listeners[event]) return;
            queueMicrotask(() => {
                this.listeners[event].forEach(cb => Fn.tryCatch(cb)(data));
            });
        }
    }
};

/**
 * Handles validation of URL patterns against detection logic.
 * @responsibility
 * 1. Verify ad pattern matching logic.
 * 2. Verify availability check pattern matching.
 * 3. Provide test results for debugging.
 */
const PatternTester = (() => {
    return {
        test: () => {
            const tests = [
                // Query parameter injection
                { url: 'https://twitch.tv/ad_state/?x=1', expected: { isDelivery: true }, name: 'Delivery with query param' },
                { url: 'https://twitch.tv/api?url=/ad_state/', expected: { isDelivery: false }, name: 'Query param injection (should NOT match)' },
                { url: 'https://twitch.tv/video#/ad_state/', expected: { isDelivery: false }, name: 'Hash fragment (should NOT match)' },

                // File extension matching  
                { url: 'https://cdn.com/stream.m3u8?v=2', expected: { mockType: 'application/vnd.apple.mpegurl' }, name: 'M3U8 in pathname' },
                { url: 'https://cdn.com/api?file=test.m3u8', expected: { mockType: 'application/json' }, name: 'M3U8 in query param (should NOT match)' },

                // Availability check patterns
                { url: 'https://twitch.tv/api?bp=preroll&channel=test', expected: { isAvailability: true }, name: 'Availability query param' },
                { url: 'https://twitch.tv/bp=preroll', expected: { isAvailability: false }, name: 'Availability in pathname (should NOT match)' }
            ];

            Logger.add('========== URL PATTERN VALIDATION STARTED ==========');
            let passed = 0, failed = 0;

            tests.forEach((test, index) => {
                const results = {
                    isDelivery: Logic.Network.isDelivery(test.url),
                    isAvailability: Logic.Network.isAvailabilityCheck(test.url),
                    mockType: Logic.Network.getMock(test.url).type
                };

                let testPassed = true;
                const failures = [];

                for (const [key, expected] of Object.entries(test.expected)) {
                    if (results[key] !== expected) {
                        testPassed = false;
                        failures.push(`${key}: expected ${expected}, got ${results[key]}`);
                    }
                }

                if (testPassed) {
                    passed++;
                    Logger.add(`[TEST ${index + 1}] ✓ PASSED: ${test.name}`, { url: test.url, results });
                } else {
                    failed++;
                    Logger.add(`[TEST ${index + 1}] ✗ FAILED: ${test.name}`, { url: test.url, expected: test.expected, actual: results, failures });
                }
            });

            const summary = `Tests Complete: ${passed} passed, ${failed} failed`;
            Logger.add(`========== ${summary} ==========`);
            return { passed, failed, total: tests.length };
        }
    };
})();

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

        // 1. Static pattern match (fastest)
        if (CONFIG.regex.AD_BLOCK.test(url)) {
            return true;
        }

        // 2. Fuzzy regex patterns for variations (Plan A)
        const fuzzyPatterns = CONFIG.network.AD_PATTERN_REGEX;
        if (fuzzyPatterns && Array.isArray(fuzzyPatterns)) {
            for (const regex of fuzzyPatterns) {
                if (regex.test(url)) {
                    Logger.add('[AdDetection] Fuzzy pattern match detected', {
                        url: url.substring(0, 150),
                        matchedPattern: regex.toString()
                    });
                    return true;
                }
            }
        }

        // 3. Dynamic patterns from external sources (Plan B)
        if (CONFIG.experimental?.ENABLE_LIVE_PATTERNS &&
            typeof PatternUpdater !== 'undefined' &&
            PatternUpdater.matchesDynamic(url)) {
            // Already logged inside matchesDynamic
            return true;
        }

        return false;
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


// --- Mock Generator ---
/**
 * Generates mock responses for intercepted ad requests.
 */
const MockGenerator = (() => {
    /**
     * Determines appropriate mock response based on URL
     * @param {string} url - URL to generate mock for
     * @returns {{body: string, type: string}} Mock response with body and MIME type
     */
    const getMock = (url) => {
        if (!url || typeof url !== 'string') {
            return { body: CONFIG.mock.JSON, type: 'application/json' };
        }

        const parsed = UrlParser.parseUrl(url);
        const pathname = parsed ? parsed.pathname : url;

        // Check file extension in pathname only (not query params)
        if (pathname.endsWith('.m3u8')) {
            return { body: CONFIG.mock.M3U8, type: 'application/vnd.apple.mpegurl' };
        }
        if (pathname.includes('vast') || pathname.endsWith('.xml')) {
            return { body: CONFIG.mock.VAST, type: 'application/xml' };
        }
        return { body: CONFIG.mock.JSON, type: 'application/json' };
    };

    return {
        getMock
    };
})();

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

// --- Ad Analytics ---
/**
 * Tracks and analyzes ad detection and recovery correlation.
 * @responsibility
 * 1. Track ad detection events.
 * 2. Correlate health triggers with ad detections.
 * 3. Generate statistical reports on detection accuracy.
 */
const AdAnalytics = (() => {
    // Correlation tracking
    let lastAdDetectionTime = 0;
    let recoveryTriggersWithoutAds = 0;

    const init = () => {
        // 1. Listen for Health Triggers
        Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
            if (payload.source === 'HEALTH') {
                // Health monitor triggered recovery
                const timeSinceLastAd = Date.now() - lastAdDetectionTime;

                // If > 10 seconds since last network detection, could be a missed ad
                if (timeSinceLastAd > 10000) {
                    recoveryTriggersWithoutAds++;

                    Logger.add('[CORRELATION] Recovery triggered without recent ad detection', {
                        trigger: payload.trigger,
                        reason: payload.reason,
                        timeSinceLastNetworkAd: (timeSinceLastAd / 1000).toFixed(1) + 's',
                        totalMissedCount: recoveryTriggersWithoutAds,
                        suggestion: 'Possible missed ad pattern or legitimate stuck state'
                    });
                }
            }
        });

        // 2. Listen for Log/Report Requests
        Adapters.EventBus.on(CONFIG.events.LOG, () => {
            generateCorrelationReport();
        });
    };

    const trackDetection = () => {
        lastAdDetectionTime = Date.now();
    };

    const generateCorrelationReport = () => {
        const adsDetected = Metrics.get('ads_detected');
        const healthTriggers = Metrics.get('health_triggers');

        const report = {
            ads_detected_network: adsDetected,
            health_triggered_recoveries: healthTriggers,
            recoveries_without_ads: recoveryTriggersWithoutAds,
            detection_accuracy: healthTriggers > 0 ?
                ((adsDetected / healthTriggers) * 100).toFixed(1) + '%' : 'N/A',
            interpretation: healthTriggers > adsDetected * 1.5 ?
                'ALERT: Health triggers significantly exceed ad detections - patterns may be incomplete' :
                'Normal: Ad detection appears accurate'
        };

        Logger.add('[CORRELATION] Statistical report', report);
        return report;
    };

    return {
        init,
        trackDetection,
        getCorrelationStats: () => ({
            lastAdDetectionTime,
            recoveryTriggersWithoutAds,
            ratio: recoveryTriggersWithoutAds > 0 ?
                recoveryTriggersWithoutAds / (Metrics.get('ads_detected') || 1) : 0
        })
    };
})();

// --- Signature Validator ---
/**
 * Player signature validation and tracking.
 */
const SignatureValidator = (() => {
    // Session reference - shared across all signatures
    const sessionRef = { current: null };

    /**
     * Creates a signature validator with session tracking
     * @param {string} id - Signature ID (k0, k1, k2)
     * @param {number} argsLength - Expected function argument count
     * @returns {{id: string, check: Function}} Signature validator
     */
    const createSignature = (id, argsLength) => ({
        id,
        check: (o, k) => {
            try {
                const result = typeof o[k] === 'function' && o[k].length === argsLength;

                if (result && sessionRef.current) {
                    const session = sessionRef.current;

                    // Only log key changes after initial discovery period (500ms grace period)
                    const isInitialDiscovery = Date.now() - session.mountTime < 500;
                    if (session[id] && session[id] !== k && !isInitialDiscovery) {
                        const change = {
                            timestamp: Date.now(),
                            signatureId: id,
                            oldKey: session[id],
                            newKey: k,
                            timeSinceMount: Date.now() - session.mountTime
                        };

                        session.keyHistory.push(change);
                        Logger.add('[Logic] ⚠️ SIGNATURE KEY CHANGED DURING SESSION', change);
                    }

                    // Update session key
                    if (!session[id] || session[id] !== k) {
                        session[id] = k;
                        Logger.add('[Logic] Signature key set', {
                            id,
                            key: k,
                            sessionId: session.sessionId,
                            isChange: session[id] !== null
                        });
                    }
                }

                return result;
            } catch (e) {
                return false;
            }
        }
    });

    /**
     * Player function signatures
     */
    const signatures = [
        createSignature('k0', 1),
        createSignature('k1', 0),
        createSignature('k2', 0)
    ];

    /**
     * Validates an object property against a signature
     * @param {Object} obj - Object to validate
     * @param {string} key - Key to check
     * @param {Object} sig - Signature definition
     * @returns {boolean} True if valid
     */
    const validate = (obj, key, sig) =>
        Fn.tryCatch(() => typeof obj[key] === 'function' && sig.check(obj, key), () => false)();

    /**
     * Sets the current session for signature tracking
     * @param {Object} session - Session object
     */
    const setSession = (session) => {
        sessionRef.current = session;
    };

    return {
        signatures,
        validate,
        setSession
    };
})();

// --- Session Manager ---
/**
 * Manages player session lifecycle and signature tracking.
 */
const SessionManager = (() => {
    // Session state
    let _sessionSignatures = {
        sessionId: null,
        mountTime: null,
        k0: null,
        k1: null,
        k2: null,
        keyHistory: []
    };

    /**
     * Starts a new player session
     */
    const startSession = () => {
        const sessionId = `session-${Date.now()}`;
        _sessionSignatures = {
            sessionId,
            mountTime: Date.now(),
            k0: null,
            k1: null,
            k2: null,
            keyHistory: []
        };

        // Update signature validators with new session
        SignatureValidator.setSession(_sessionSignatures);

        Logger.add('[Logic] New player session started', { sessionId });
    };

    /**
     * Ends the current session
     */
    const endSession = () => {
        const session = _sessionSignatures;
        if (!session.sessionId) return;

        Logger.add('[Logic] Player session ended', {
            sessionId: session.sessionId,
            duration: Date.now() - session.mountTime,
            finalKeys: {
                k0: session.k0,
                k1: session.k1,
                k2: session.k2
            },
            keyChanges: session.keyHistory.length
        });

        if (session.keyHistory.length > 0) {
            Logger.add('[Logic] ⚠️ ALERT: Signature keys changed during session', {
                sessionId: session.sessionId,
                changes: session.keyHistory
            });
        }

        // Clear session reference
        SignatureValidator.setSession(null);
    };

    /**
     * Gets current session status
     * @returns {Object} Session status
     */
    const getSessionStatus = () => {
        const session = _sessionSignatures;
        return {
            sessionId: session.sessionId,
            uptime: session.mountTime ? Date.now() - session.mountTime : 0,
            currentKeys: {
                k0: session.k0,
                k1: session.k1,
                k2: session.k2
            },
            totalChanges: session.keyHistory.length,
            recentChanges: session.keyHistory.slice(-5),
            allKeysSet: !!(session.k0 && session.k1 && session.k2)
        };
    };

    /**
     * Checks if session is unstable (too many key changes)
     * @returns {boolean} True if unstable
     */
    const isSessionUnstable = () => {
        const session = _sessionSignatures;

        const hourAgo = Date.now() - 3600000;
        const recentChanges = session.keyHistory.filter(c => c.timestamp > hourAgo);

        const isUnstable = recentChanges.length > 3;

        if (isUnstable) {
            Logger.add('[Logic] ⚠️ ALERT: Signature session UNSTABLE', {
                changesInLastHour: recentChanges.length,
                threshold: 3,
                suggestion: 'Twitch may have updated player - patterns may break soon'
            });
        }

        return isUnstable;
    };

    /**
     * Gets signature stats (alias for backward compatibility)
     * @returns {Object} Session status
     */
    const getSignatureStats = () => getSessionStatus();

    return {
        startSession,
        endSession,
        getSessionStatus,
        isSessionUnstable,
        getSignatureStats
    };
})();

// --- Signature Detector ---
/**
 * Detects player function signatures in objects.
 */
const SignatureDetector = (() => {
    // Key map to cache found signature keys
    const keyMap = { k0: null, k1: null, k2: null };

    /**
     * Detects player function signatures in an object.
     * Attempts to match object properties against known player method signatures.
     * @param {Object} obj - Object to scan for player signatures
     * @returns {boolean} True if all required signatures were found
     */
    const detectPlayerSignatures = (obj) => {
        for (const sig of Logic.Player.signatures) {
            // If a key is already mapped and still valid, skip searching for it again.
            if (keyMap[sig.id] && Logic.Player.validate(obj, keyMap[sig.id], sig)) {
                continue;
            }
            const foundKey = Object.keys(obj).find(k => Logic.Player.validate(obj, k, sig));
            if (foundKey) {
                keyMap[sig.id] = foundKey;
                Logger.add('Player signature found', { id: sig.id, key: foundKey });
            }
        }
        return Object.values(keyMap).every(k => k !== null);
    };

    /**
     * Resets the key map
     */
    const reset = () => {
        keyMap.k0 = null;
        keyMap.k1 = null;
        keyMap.k2 = null;
    };

    /**
     * Gets the current key map
     * @returns {Object} Key map
     */
    const getKeyMap = () => keyMap;

    return {
        detectPlayerSignatures,
        reset,
        getKeyMap
    };
})();

// --- Context Traverser ---
/**
 * Traverses object trees to find player context.
 */
const ContextTraverser = (() => {
    const fallbackSelectors = ['.video-player__container', '.highwind-video-player', '[data-a-target="video-player"]'];

    /**
     * Recursively traverses object tree to find the player context using Breadth-First Search (BFS).
     * Searches for React/Vue internal player component instance.
     * @param {Object} rootObj - Object to traverse
     * @returns {Object|null} Player context object if found, null otherwise
     */
    const traverseForPlayerContext = (rootObj) => {
        const queue = [{ node: rootObj, depth: 0 }];
        const visited = new WeakSet();

        while (queue.length > 0) {
            const { node, depth } = queue.shift();

            if (depth > CONFIG.player.MAX_SEARCH_DEPTH) continue;
            if (!node || typeof node !== 'object' || visited.has(node)) continue;

            visited.add(node);

            if (SignatureDetector.detectPlayerSignatures(node)) {
                return node;
            }

            // Add children to queue
            for (const key of Object.keys(node)) {
                queue.push({ node: node[key], depth: depth + 1 });
            }
        }
        return null;
    };

    /**
     * Fallback strategy using DOM selectors
     * @returns {{ctx: Object, element: HTMLElement}|null} Found context and element
     */
    const findContextFallback = () => {
        for (const selector of fallbackSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const key = Object.keys(el).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
                if (key && el[key]) {
                    const ctx = traverseForPlayerContext(el[key]);
                    if (ctx) return { ctx, element: el };
                }
            }
        }
        return null;
    };

    return {
        traverseForPlayerContext,
        findContextFallback
    };
})();

// --- Context Validator ---
/**
 * Validates player context cache and liveness.
 */
const ContextValidator = (() => {
    /**
     * Validates the cached context to ensure it's still usable.
     * @param {Object} cachedContext - The context to validate
     * @param {HTMLElement} cachedRootElement - The root element associated with the context
     * @returns {boolean} True if cache is valid, false otherwise
     */
    const validateCache = (cachedContext, cachedRootElement) => {
        if (!cachedContext) return false;

        // 1. DOM Attachment Check
        if (cachedRootElement && !cachedRootElement.isConnected) {
            Logger.add('PlayerContext: Cache invalid - Root element detached from DOM');
            return false;
        }

        // 2. Signature Function Check
        const keyMap = SignatureDetector.getKeyMap();
        const signaturesValid = Object.keys(keyMap).every(
            (key) => keyMap[key] && typeof cachedContext[keyMap[key]] === 'function'
        );

        if (!signaturesValid) {
            Logger.add('PlayerContext: Cache invalid - Signatures missing', { keyMap });
            return false;
        }

        // 3. Liveness Check (safe property access)
        try {
            // Test that context is actually accessible
            const testKey = keyMap.k0;
            if (testKey && cachedContext[testKey]) {
                // Context appears alive
            }
        } catch (e) {
            Logger.add('PlayerContext: Cache invalid - Liveness check failed', { error: String(e) });
            return false;
        }

        return true;
    };

    return {
        validateCache
    };
})();

/**
 * Shared constants for recovery modules.
 */
const RecoveryConstants = {
    SEVERITY: {
        MINOR: 'minor',       // < 1000ms
        MODERATE: 'moderate', // 1000-3000ms
        SEVERE: 'severe',     // 3000-10000ms
        CRITICAL: 'critical'  // > 10000ms
    }
};

// --- Video Snapshot Helper ---
/**
 * Utilities for capturing and comparing video state.
 */
const VideoSnapshotHelper = (() => {
    /**
     * Captures a snapshot of current video element state.
     * @param {HTMLVideoElement} video - The video element to snapshot
     * @returns {Object} Snapshot containing readyState, networkState, currentTime, etc.
     */
    const captureVideoSnapshot = (video) => {
        return {
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
            paused: video.paused,
            error: video.error ? video.error.code : null,
            bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
        };
    };

    /**
     * Calculates the delta between pre and post recovery snapshots.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @returns {Object} Delta object showing what changed
     */
    const calculateRecoveryDelta = (preSnapshot, postSnapshot) => {
        return {
            readyStateChanged: preSnapshot.readyState !== postSnapshot.readyState,
            networkStateChanged: preSnapshot.networkState !== postSnapshot.networkState,
            currentTimeChanged: preSnapshot.currentTime !== postSnapshot.currentTime,
            pausedStateChanged: preSnapshot.paused !== postSnapshot.paused,
            errorCleared: preSnapshot.error && !postSnapshot.error,
            errorAppeared: !preSnapshot.error && postSnapshot.error,
            bufferIncreased: postSnapshot.bufferEnd > preSnapshot.bufferEnd
        };
    };

    return {
        captureVideoSnapshot,
        calculateRecoveryDelta
    };
})();

/**
 * Manages recovery concurrency and timeouts.
 * Ensures only one recovery operation runs at a time.
 */
const RecoveryLock = (() => {
    let isFixing = false;
    let recoveryStartTime = 0;
    const RECOVERY_TIMEOUT_MS = 10000;

    return {
        /**
         * Attempts to acquire the recovery lock.
         * @returns {boolean} True if lock acquired, false if already locked.
         */
        acquire: () => {
            if (isFixing) {
                // Check for stale lock
                if (Date.now() - recoveryStartTime > RECOVERY_TIMEOUT_MS) {
                    Logger.add('[Resilience] Force-resetting stuck recovery lock');
                    isFixing = false;
                } else {
                    return false;
                }
            }

            isFixing = true;
            recoveryStartTime = Date.now();
            return true;
        },

        /**
         * Releases the recovery lock.
         */
        release: () => {
            isFixing = false;
            recoveryStartTime = 0;
        },

        /**
         * Checks if recovery is currently in progress.
         * @returns {boolean}
         */
        isLocked: () => isFixing
    };
})();

// --- Recovery Validator ---
/**
 * Validates recovery outcomes and pre-conditions.
 */
const RecoveryValidator = (() => {
    // Time progression tracking for health detection
    let lastHealthCheckTime = 0;
    let lastHealthCheckVideoTime = 0;
    let lastFrameCount = 0; // NEW: Frame-based tracking
    const MIN_PROGRESSION_S = 0.3; // Video must advance at least 0.3s between checks
    const CHECK_WINDOW_MS = 2000; // Time window for progression check
    const MIN_FRAME_ADVANCEMENT = 5; // Minimum frames that should advance

    /**
     * Validates if recovery actually improved the state.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @param {Object} delta - Calculated changes
     * @returns {{isValid: boolean, issues: string[], hasImprovement: boolean}}
     */
    const validateRecoverySuccess = (preSnapshot, postSnapshot, delta) => {
        const issues = [];

        // Check 1: Ready state should not decrease
        if (delta.readyStateChanged && postSnapshot.readyState < preSnapshot.readyState) {
            issues.push(`readyState decreased: ${preSnapshot.readyState} → ${postSnapshot.readyState}`);
        }

        // Check 2: Error should not appear
        if (delta.errorAppeared) {
            issues.push(`MediaError appeared: code ${postSnapshot.error}`);
        }

        // Check 3: Should have some positive change
        const hasImprovement = (
            delta.errorCleared ||  // Error was fixed
            (delta.readyStateChanged && postSnapshot.readyState > preSnapshot.readyState) ||
            (postSnapshot.bufferEnd > preSnapshot.bufferEnd + 0.1) // Buffer increased
        );

        if (!hasImprovement && !delta.pausedStateChanged) {
            issues.push('No measurable improvement detected');
        }

        // Log validation result
        Logger.add('[RecoveryValidator] Validation complete', {
            isValid: issues.length === 0,
            hasImprovement,
            issueCount: issues.length,
            issues: issues.length > 0 ? issues : undefined
        });

        return {
            isValid: issues.length === 0,
            issues,
            hasImprovement
        };
    };

    /**
     * Checks if the video is already healthy enough to skip recovery.
     * Now includes frame progression check for more reliable detection.
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if healthy (with verified time/frame progression)
     */
    const detectAlreadyHealthy = (video) => {
        const now = Date.now();
        const currentVideoTime = video.currentTime;

        // Capture initial state for logging
        const state = {
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            error: video.error?.code || null,
            currentTime: currentVideoTime.toFixed(3)
        };

        // Basic checks first
        const basicHealthy = (
            !video.paused &&
            video.readyState >= 3 &&
            !video.error &&
            video.networkState !== 3 // NETWORK_NO_SOURCE
        );

        if (!basicHealthy) {
            Logger.add('[RecoveryValidator] Basic health check FAILED', {
                ...state,
                reason: video.paused ? 'paused' :
                    video.readyState < 3 ? 'readyState<3' :
                        video.error ? 'error' : 'networkState=NO_SOURCE'
            });
            lastHealthCheckTime = now;
            lastHealthCheckVideoTime = currentVideoTime;
            lastFrameCount = 0;
            return false;
        }

        // NEW: Frame progression check (more reliable than time)
        let frameAdvancement = 0;
        const quality = video.getVideoPlaybackQuality?.();
        if (quality) {
            const currentFrames = quality.totalVideoFrames;
            frameAdvancement = currentFrames - lastFrameCount;

            if (lastFrameCount > 0 && frameAdvancement < MIN_FRAME_ADVANCEMENT) {
                Logger.add('[RecoveryValidator] Frame progression FAILED', {
                    ...state,
                    frameAdvancement,
                    currentFrames,
                    lastFrameCount,
                    minRequired: MIN_FRAME_ADVANCEMENT
                });
                lastFrameCount = currentFrames;
                return false; // Frames stuck = actually not healthy
            }
            lastFrameCount = currentFrames;
        }

        // Time progression check as fallback
        const timeSinceLastCheck = now - lastHealthCheckTime;
        const videoTimeAdvancement = currentVideoTime - lastHealthCheckVideoTime;

        lastHealthCheckTime = now;
        lastHealthCheckVideoTime = currentVideoTime;

        if (timeSinceLastCheck > 0 && timeSinceLastCheck < CHECK_WINDOW_MS) {
            if (videoTimeAdvancement < MIN_PROGRESSION_S) {
                Logger.add('[RecoveryValidator] Time progression FAILED', {
                    ...state,
                    videoTimeAdvancement: videoTimeAdvancement.toFixed(3),
                    minRequired: MIN_PROGRESSION_S,
                    timeSinceLastCheck
                });
                return false;
            }
        }

        Logger.add('[RecoveryValidator] Health check PASSED', {
            ...state,
            videoTimeAdvancement: videoTimeAdvancement.toFixed(3),
            frameAdvancement: frameAdvancement || 'N/A (no quality API)'
        });
        return true;
    };

    return {
        validateRecoverySuccess,
        detectAlreadyHealthy
    };
})();


// --- A/V Sync Router ---
/**
 * Routes A/V sync issues to specialized recovery.
 */
const AVSyncRouter = (() => {
    /**
     * Checks if the issue should be routed to A/V sync recovery.
     * @param {string} reason - The reason for recovery
     * @returns {boolean} True if it's an A/V sync issue
     */
    const shouldRouteToAVSync = (reason) => {
        return reason === CONFIG.events.AV_SYNC_ISSUE;
    };

    /**
     * Executes A/V sync recovery.
     * @returns {Promise<boolean>} True if recovery was successful
     */
    const executeAVSyncRecovery = async () => {
        Logger.add('[Resilience] Routing to AVSyncRecovery');
        return await AVSyncRecovery.fix();
    };

    return {
        shouldRouteToAVSync,
        executeAVSyncRecovery
    };
})();

// --- Play Validator ---
/**
 * Validates video state for playback.
 */
const PlayValidator = (() => {
    /**
     * Checks if the video is in a state that allows playback.
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if playable
     */
    const validatePlayable = (video) => {
        if (!video) return false;
        if (video.error) return false;
        if (video.readyState < 2) return false; // HAVE_CURRENT_DATA
        return true;
    };

    /**
     * Waits for the video to actually start playing.
     * @param {HTMLVideoElement} video - The video element
     * @param {number} timeoutMs - Max wait time
     * @returns {Promise<boolean>} True if playing detected
     */
    const waitForPlaying = (video, timeoutMs = 2000) => {
        return new Promise((resolve) => {
            if (!video.paused && video.readyState >= 3) {
                resolve(true);
                return;
            }

            let resolved = false;
            const cleanup = () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('timeupdate', onTimeUpdate);
            };

            const onPlaying = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            const onTimeUpdate = () => {
                if (!resolved && !video.paused) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            video.addEventListener('playing', onPlaying, { once: true });
            video.addEventListener('timeupdate', onTimeUpdate, { once: true });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(false);
                }
            }, timeoutMs);
        });
    };

    return {
        validatePlayable,
        waitForPlaying
    };
})();

// --- Micro Seek Strategy ---
/**
 * Implements intelligent seeking to unstick playback.
 */
const MicroSeekStrategy = (() => {
    /**
     * Determines if a micro-seek should be applied.
     * @param {HTMLVideoElement} video - The video element
     * @param {number} attempt - Current retry attempt number
     * @returns {boolean} True if micro-seek is recommended
     */
    const shouldApplyMicroSeek = (video, attempt) => {
        // Apply on later attempts or if buffer is stuck
        return attempt > 1 || (video.readyState >= 2 && video.paused);
    };

    /**
     * Calculates the optimal seek target.
     * @param {HTMLVideoElement} video - The video element
     * @returns {number} Target timestamp
     */
    const calculateSeekTarget = (video) => {
        // Prefer seeking forward slightly to hit buffered content
        if (video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1);
            if (end > video.currentTime + 0.1) {
                return Math.min(video.currentTime + 0.05, end - 0.1);
            }
        }
        // Fallback: tiny forward seek or stay in place
        return video.currentTime + 0.001;
    };

    /**
     * Executes a micro-seek operation.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Promise<void>} Resolves when seek completes
     */
    const executeMicroSeek = (video) => {
        return new Promise((resolve) => {
            const target = calculateSeekTarget(video);

            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
            };

            // Safety timeout in case seeked never fires
            const timeoutId = setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                Logger.add('[PlayRetry] Micro-seek timeout');
                resolve();
            }, 1000);

            video.addEventListener('seeked', () => {
                clearTimeout(timeoutId);
                onSeeked();
            }, { once: true });

            video.currentTime = target;
            Logger.add('[PlayRetry] Applied micro-seek', { target: target.toFixed(3) });
        });
    };

    return {
        shouldApplyMicroSeek,
        calculateSeekTarget,
        executeMicroSeek
    };
})();

// --- Play Executor ---
/**
 * Executes play attempts and handles errors.
 */
const PlayExecutor = (() => {
    /**
     * Attempts to play the video once.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Promise<void>} Resolves on success, rejects with error
     */
    const attemptPlay = async (video) => {
        try {
            await video.play();
        } catch (error) {
            throw error;
        }
    };

    /**
     * Categorizes a play error for logging and decision making.
     * @param {Error} error - The error thrown by video.play()
     * @returns {{name: string, isFatal: boolean, message: string}}
     */
    const categorizePlayError = (error) => {
        const name = error.name || 'UnknownError';
        const message = error.message || 'No message';

        return {
            name,
            message,
            isFatal: isFatalError(name)
        };
    };

    /**
     * Determines if an error is fatal (should stop retries).
     * @param {string} errorName - The error name
     * @returns {boolean} True if fatal
     */
    const isFatalError = (errorName) => {
        return errorName === 'NotAllowedError' || errorName === 'NotSupportedError';
    };

    return {
        attemptPlay,
        categorizePlayError,
        isFatalError
    };
})();

// --- Network Logic Module ---
/**
 * Aggregates all network-related utilities.
 */
const _NetworkLogic = (() => {
    return {
        // UrlParser
        _parseUrl: UrlParser.parseUrl,
        _pathMatches: UrlParser.pathMatches,

        // AdDetection
        isAd: AdDetection.isAd,
        isTrigger: AdDetection.isTrigger,
        isDelivery: AdDetection.isDelivery,
        isAvailabilityCheck: AdDetection.isAvailabilityCheck,

        // MockGenerator
        getMock: MockGenerator.getMock,

        // PatternDiscovery
        detectNewPatterns: PatternDiscovery.detectNewPatterns,
        getDiscoveredPatterns: PatternDiscovery.getDiscoveredPatterns,
        exportCapturedUrls: PatternDiscovery.exportCapturedUrls,
        clearCaptured: PatternDiscovery.clearCaptured
    };
})();

// --- Player Logic Module ---
/**
 * Aggregates all player-related utilities.
 */
const _PlayerLogic = (() => {
    return {
        // SignatureValidator
        signatures: SignatureValidator.signatures,
        validate: SignatureValidator.validate,

        // SessionManager
        startSession: SessionManager.startSession,
        endSession: SessionManager.endSession,
        getSessionStatus: SessionManager.getSessionStatus,
        isSessionUnstable: SessionManager.isSessionUnstable,
        getSignatureStats: SessionManager.getSignatureStats
    };
})();

// ============================================================================
// 4. LOGIC KERNELS
// ============================================================================
/**
 * Pure business logic for Network analysis and Player signature matching.
 * @namespace Logic
 */
const Logic = (() => {
    return {
        Network: _NetworkLogic,
        Player: _PlayerLogic
    };
})();

// --- DOM Observer ---
/**
 * Observes DOM for player mounting and unmounting.
 * @responsibility
 * 1. Watch document.body for player container changes.
 * 2. Delegate to PlayerLifecycle for mount/unmount handling.
 */
const DOMObserver = (() => {
    let rootObserver = null;

    const findAndMountPlayer = (node) => {
        if (node.nodeType !== 1) return;
        const player = node.matches(CONFIG.selectors.PLAYER) ?
            node : node.querySelector(CONFIG.selectors.PLAYER);
        if (player) {
            PlayerLifecycle.handleMount(player);
        }
    };

    const findAndUnmountPlayer = (node) => {
        const activeContainer = PlayerLifecycle.getActiveContainer();
        if (activeContainer && (node === activeContainer ||
            (node.contains && node.contains(activeContainer)))) {
            PlayerLifecycle.handleUnmount();
        }
    };

    return {
        init: () => {
            const existing = Adapters.DOM.find(CONFIG.selectors.PLAYER);
            if (existing) {
                PlayerLifecycle.handleMount(existing);
            }

            rootObserver = Adapters.DOM.observe(document.body, (mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(findAndMountPlayer);
                        m.removedNodes.forEach(findAndUnmountPlayer);
                    }
                }
            }, { childList: true, subtree: true });
        }
    };
})();

// --- Event Coordinator ---
/**
 * Sets up EventBus listeners and coordinates event responses.
 * @responsibility Wire up global event listeners for ACQUIRE and AD_DETECTED.
 */
const EventCoordinator = (() => {
    return {
        init: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, (payload) => {
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    const playerContext = PlayerContext.get(container);
                    if (playerContext) {
                        Logger.add('[LIFECYCLE] Event: ACQUIRE - Success', payload);
                        HealthMonitor.start(container);

                        // Plan B: Apply player patches if enabled
                        if (CONFIG.experimental?.ENABLE_PLAYER_PATCHING &&
                            typeof PlayerPatcher !== 'undefined') {
                            PlayerPatcher.apply(playerContext);
                        }
                    } else {
                        Logger.add('[LIFECYCLE] Event: ACQUIRE - Failed', payload);
                    }
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
                // Enhanced logging with source and trigger context
                if (payload?.source) {
                    const triggerInfo = payload.trigger ? ` | Trigger: ${payload.trigger}` : '';
                    const reasonInfo = payload.reason ? ` | Reason: ${payload.reason}` : '';
                    Logger.add(`[EVENT] AD_DETECTED | Source: ${payload.source}${triggerInfo}${reasonInfo}`, payload.details || {});
                } else {
                    // Fallback for events without payload (backward compatibility)
                    Logger.add('[EVENT] AD_DETECTED | Source: UNKNOWN');
                }

                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    ResilienceOrchestrator.execute(container, payload);
                }
            });
        }
    };
})();

// --- Player Lifecycle ---
/**
 * Manages player container lifecycle (mount/unmount).
 * @responsibility
 * 1. Track active player container.
 * 2. Setup player-specific observers.
 * 3. Coordinate with VideoListenerManager and HealthMonitor.
 */
const PlayerLifecycle = (() => {
    let activeContainer = null;
    let playerObserver = null;

    return {
        getActiveContainer: () => activeContainer,

        inject: () => {
            Store.update({ lastAttempt: Date.now() });
            Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
        },

        handleMount: (container) => {
            if (activeContainer === container) return;
            if (activeContainer) PlayerLifecycle.handleUnmount();

            Logger.add('Player mounted');
            activeContainer = container;

            // Start signature session tracking
            Logic.Player.startSession();

            const debouncedInject = Fn.debounce(() => PlayerLifecycle.inject(), 100);
            playerObserver = Adapters.DOM.observe(container, (mutations) => {
                const shouldReacquire = mutations.some(m => {
                    if (m.type === 'attributes' && m.attributeName === 'class' && m.target === container) {
                        return true;
                    }
                    if (m.type === 'childList') {
                        const hasVideo = (nodes) => Array.from(nodes).some(n =>
                            n.matches && n.matches(CONFIG.selectors.VIDEO)
                        );
                        return hasVideo(m.addedNodes) || hasVideo(m.removedNodes);
                    }
                    return false;
                });
                if (shouldReacquire) debouncedInject();
            }, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            VideoListenerManager.attach(container);
            PlayerLifecycle.inject();
        },

        handleUnmount: () => {
            if (!activeContainer) return;
            Logger.add('Player unmounted');

            // End signature session tracking
            Logic.Player.endSession();

            if (playerObserver) {
                playerObserver.disconnect();
                playerObserver = null;
            }

            VideoListenerManager.detach();
            HealthMonitor.stop();
            PlayerContext.reset();
            activeContainer = null;
        }
    };
})();

// --- Script Blocker ---
/**
 * Blocks ad-related scripts from loading.
 * @responsibility Monitor DOM for ad script injections and remove them.
 */
const ScriptBlocker = (() => {
    const AD_SCRIPT_PATTERNS = [
        'supervisor.ext-twitch.tv',
        'pubads.g.doubleclick.net'
    ];

    const shouldBlock = (scriptNode) => {
        return scriptNode.tagName === 'SCRIPT' &&
            scriptNode.src &&
            AD_SCRIPT_PATTERNS.some(pattern => scriptNode.src.includes(pattern));
    };

    return {
        init: () => {
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    m.addedNodes.forEach(n => {
                        if (shouldBlock(n)) {
                            n.remove();
                            Logger.add('Blocked Script', { src: n.src });
                        }
                    });
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    };
})();

// --- A/V Sync Detector ---
/**
 * Monitors audio/video synchronization to detect drift issues.
 * @responsibility Track time advancement vs real-world time to detect A/V sync problems.
 */
const AVSyncDetector = (() => {
    let state = {
        lastSyncCheckTime: 0,
        lastSyncVideoTime: 0,
        syncIssueCount: 0
    };

    const reset = (video = null) => {
        state.lastSyncCheckTime = 0;
        state.lastSyncVideoTime = video ? video.currentTime : 0;
        state.syncIssueCount = 0;
    };

    const check = (video) => {
        if (!video) return null;
        if (video.paused || video.ended || video.readyState < 2) {
            if (state.syncIssueCount > 0) {
                Logger.add('A/V sync recovered', { previousIssues: state.syncIssueCount });
                state.syncIssueCount = 0;
            }
            return null;
        }

        const now = Date.now();
        if (state.lastSyncCheckTime > 0) {
            const elapsedRealTime = (now - state.lastSyncCheckTime) / 1000;
            const expectedTimeAdvancement = elapsedRealTime * video.playbackRate;
            const actualTimeAdvancement = video.currentTime - state.lastSyncVideoTime;
            const discrepancy = Math.abs(expectedTimeAdvancement - actualTimeAdvancement);
            const discrepancyMs = discrepancy * 1000;

            // Extensive logging: Log every sync check for visibility
            if (discrepancy > CONFIG.timing.AV_SYNC_THRESHOLD_MS / 1000 && expectedTimeAdvancement > 0.1) {
                state.syncIssueCount++;
                Logger.add('[HEALTH] A/V sync issue detected', {
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    count: state.syncIssueCount,
                    detectionThreshold: CONFIG.timing.AV_SYNC_THRESHOLD_MS + 'ms',
                    recoveryThreshold: CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS + 'ms',
                    willTriggerRecovery: discrepancyMs >= CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS
                });
            } else if (discrepancy < CONFIG.timing.AV_SYNC_THRESHOLD_MS / 2000) {
                if (state.syncIssueCount > 0) {
                    Logger.add('[HEALTH] A/V sync recovered', {
                        previousIssues: state.syncIssueCount,
                        currentDiscrepancy: discrepancyMs.toFixed(2) + 'ms'
                    });
                    state.syncIssueCount = 0;
                }
            }

            // CHANGED: Only trigger recovery if discrepancy exceeds RECOVERY threshold (2000ms)
            // Previously triggered after 3 consecutive detections regardless of severity
            if (state.syncIssueCount >= 5 && discrepancyMs >= CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS) {
                let severity = 'minor';
                if (discrepancyMs >= 10000) severity = 'critical';
                else if (discrepancyMs >= 3000) severity = 'severe';
                else if (discrepancyMs >= 1000) severity = 'moderate';

                Logger.add('[HEALTH] A/V sync threshold exceeded - triggering recovery', {
                    syncIssueCount: state.syncIssueCount,
                    consecutiveThreshold: 5,
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    severity,
                    recoveryThreshold: CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS + 'ms'
                });
                state.lastSyncCheckTime = now;
                state.lastSyncVideoTime = video.currentTime;
                return {
                    reason: 'Persistent A/V sync issue',
                    details: {
                        syncIssueCount: state.syncIssueCount,
                        discrepancy: discrepancyMs,
                        threshold: 5,
                        severity
                    }
                };
            } else if (state.syncIssueCount >= 5 && discrepancyMs < CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS) {
                // Extensive logging: Show when we detect issues but DON'T trigger recovery
                Logger.add('[HEALTH] A/V sync issues detected but below recovery threshold - monitoring only', {
                    syncIssueCount: state.syncIssueCount,
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    recoveryThreshold: CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS + 'ms',
                    reason: 'Trusting browser-native A/V sync for minor desyncs'
                });
                // Reset counter to avoid accumulation
                state.syncIssueCount = 0;
            }
        }
        state.lastSyncCheckTime = now;
        state.lastSyncVideoTime = video.currentTime;
        return null;
    };

    return {
        reset,
        check
    };
})();

// --- Frame Drop Detector ---
/**
 * Monitors video frame drops to detect playback quality issues.
 * @responsibility Track dropped frames and trigger recovery on severe drops.
 */
const FrameDropDetector = (() => {
    let state = {
        lastDroppedFrames: 0,
        lastTotalFrames: 0,
        lastCurrentTime: -1,
        lastCheckTimestamp: 0
    };

    const reset = () => {
        state.lastDroppedFrames = 0;
        state.lastTotalFrames = 0;
        state.lastCurrentTime = -1;
        state.lastCheckTimestamp = 0;
    };

    const validatePlaybackProgression = (video) => {
        const now = Date.now();
        const timeSinceLastCheck = now - state.lastCheckTimestamp;

        // First check or reset
        if (state.lastCurrentTime === -1) {
            state.lastCurrentTime = video.currentTime;
            state.lastCheckTimestamp = now;
            return true; // Assume playing until proven otherwise
        }

        const timeAdvanced = video.currentTime - state.lastCurrentTime;
        // Expected advance is 90% of real time to account for minor variances
        const expectedAdvance = (timeSinceLastCheck / 1000) * 0.9;

        // Update state for next check
        state.lastCurrentTime = video.currentTime;
        state.lastCheckTimestamp = now;

        // If time advanced sufficiently, video is playing
        if (timeAdvanced >= expectedAdvance) {
            return true;
        }

        // Allow for seeking or buffering states
        if (video.seeking || video.readyState < 3) {
            return true;
        }

        return false; // Video is actually stuck
    };

    const check = (video) => {
        if (!video || !video.getVideoPlaybackQuality) return null;

        const quality = video.getVideoPlaybackQuality();
        const newDropped = quality.droppedVideoFrames - state.lastDroppedFrames;
        const newTotal = quality.totalVideoFrames - state.lastTotalFrames;

        if (CONFIG.debug) {
            Logger.add('FrameDropDetector[Debug]: Frame check', {
                dropped: quality.droppedVideoFrames,
                total: quality.totalVideoFrames,
                lastDropped: state.lastDroppedFrames,
                lastTotal: state.lastTotalFrames,
                newDropped,
                newTotal,
            });
        }

        if (newDropped > 0) {
            const recentDropRate = newTotal > 0 ? (newDropped / newTotal) * 100 : 0;
            Logger.add('[HEALTH] Frame drop detected', {
                newDropped,
                newTotal,
                recentDropRate: recentDropRate.toFixed(2) + '%'
            });

            const exceedsSevere = newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD;
            const exceedsModerate = newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD &&
                recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD;

            if (exceedsSevere || exceedsModerate) {
                // CRITICAL FIX: Validate video is actually stuck before triggering
                const isActuallyPlaying = validatePlaybackProgression(video);

                if (isActuallyPlaying) {
                    Logger.add('[HEALTH] Frame drops detected but video is playing normally - ignoring', {
                        dropped: newDropped,
                        currentTime: video.currentTime
                    });
                    // Update baseline so we don't re-trigger on these frames
                    state.lastDroppedFrames = quality.droppedVideoFrames;
                    state.lastTotalFrames = quality.totalVideoFrames;
                    return null;
                }

                const severity = exceedsSevere ? 'SEVERE' : 'MODERATE';
                Logger.add(`[HEALTH] Frame drop threshold exceeded | Severity: ${severity}`, {
                    newDropped,
                    threshold: exceedsSevere ? CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD : CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD,
                    recentDropRate
                });

                state.lastDroppedFrames = quality.droppedVideoFrames;
                state.lastTotalFrames = quality.totalVideoFrames;
                return {
                    reason: `${severity} frame drop`,
                    details: { newDropped, newTotal, recentDropRate, severity }
                };
            }
        }

        state.lastDroppedFrames = quality.droppedVideoFrames;
        state.lastTotalFrames = quality.totalVideoFrames;
        return null;
    };

    return {
        reset,
        check
    };
})();

// --- Health Monitor ---
/**
 * Orchestrates health monitoring by coordinating detector modules.
 * @responsibility
 * 1. Manage timers for health checks.
 * 2. Coordinate detectors (Stuck, FrameDrop, AVSync).
 * 3. Trigger recovery when issues are detected.
 */
const HealthMonitor = (() => {
    let videoRef = null;
    const timers = { main: null, sync: null };

    // State tracking
    let isPaused = false;
    let lastTriggerTime = 0;
    // COOLDOWN_MS moved to CONFIG.timing.HEALTH_COOLDOWN_MS
    let pendingIssues = [];

    const triggerRecovery = (reason, details, triggerType) => {
        // Cooldown check
        const now = Date.now();
        if (now - lastTriggerTime < CONFIG.timing.HEALTH_COOLDOWN_MS) {
            Logger.add('[HEALTH] Trigger skipped - cooldown active', {
                timeSinceLast: (now - lastTriggerTime) / 1000
            });
            return;
        }

        Logger.add(`[HEALTH] Recovery trigger | Reason: ${reason}, Type: ${triggerType}`, details);
        Metrics.increment('health_triggers');

        lastTriggerTime = now;
        HealthMonitor.pause(); // Pause instead of stop

        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
            source: 'HEALTH',
            trigger: triggerType,
            reason: reason,
            details: details
        });
    };

    const runMainChecks = () => {
        if (!videoRef || !document.body.contains(videoRef) || isPaused) {
            return;
        }

        // Accumulate all issues
        const stuckResult = StuckDetector.check(videoRef);
        if (stuckResult) {
            pendingIssues.push({ type: 'STUCK_PLAYBACK', priority: 3, ...stuckResult });
        }

        const frameDropResult = FrameDropDetector.check(videoRef);
        if (frameDropResult) {
            pendingIssues.push({ type: 'FRAME_DROP', priority: 2, ...frameDropResult });
        }

        // NEW: Update AdCorrelation with health state
        const isHealthy = pendingIssues.length === 0;
        if (typeof AdCorrelation !== 'undefined') {
            AdCorrelation.updatePlayerState(isHealthy);
        }

        // Process issues if any found
        if (pendingIssues.length > 0) {
            // Sort by priority (highest first)
            pendingIssues.sort((a, b) => b.priority - a.priority);

            const topIssue = pendingIssues[0];
            if (pendingIssues.length > 1) {
                Logger.add('[HEALTH] Multiple issues detected, triggering for highest priority', {
                    allIssues: pendingIssues.map(i => i.type),
                    selected: topIssue.type
                });
            }

            triggerRecovery(topIssue.reason, topIssue.details, topIssue.type);
            pendingIssues = []; // Clear
        }
    };

    const runSyncCheck = () => {
        if (!videoRef || !document.body.contains(videoRef) || isPaused) {
            return;
        }

        // Check A/V sync
        const syncResult = AVSyncDetector.check(videoRef);
        if (syncResult) {
            pendingIssues.push({ type: 'AV_SYNC', priority: 1, ...syncResult });

            // A/V sync is lowest priority - only trigger if no other issues pending
            // We use a small timeout to allow main checks to run if they happen simultaneously
            setTimeout(() => {
                if (pendingIssues.some(i => i.type === 'AV_SYNC') && !isPaused) {
                    const avIssue = pendingIssues.find(i => i.type === 'AV_SYNC');
                    triggerRecovery(avIssue.reason, avIssue.details, 'AV_SYNC');
                    pendingIssues = [];
                }
            }, 100);
        }
    };

    return {
        start: (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            if (videoRef !== video) {
                HealthMonitor.stop();
                videoRef = video;
                StuckDetector.reset(video);
                FrameDropDetector.reset();
                AVSyncDetector.reset(video);
            }

            if (!timers.main) {
                timers.main = setInterval(runMainChecks, CONFIG.timing.HEALTH_CHECK_MS);
            }

            if (!timers.sync) {
                timers.sync = setInterval(runSyncCheck, CONFIG.timing.AV_SYNC_CHECK_INTERVAL_MS);
            }

            // Auto-resume on recovery completion
            Adapters.EventBus.on(CONFIG.events.REPORT, (payload) => {
                if (payload.status === 'SUCCESS' || payload.status === 'FAILED') {
                    Logger.add('[HEALTH] Recovery completed, resuming monitoring');
                    HealthMonitor.resume();
                }
            });
        },

        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            videoRef = null;
            isPaused = false;
            lastTriggerTime = 0; // Reset cooldown
            StuckDetector.reset();
            FrameDropDetector.reset();
            AVSyncDetector.reset();
        },

        pause: () => {
            if (isPaused) return;

            Logger.add('[HEALTH] Monitoring paused');
            isPaused = true;

            // Auto-resume after timeout as safety net
            setTimeout(() => {
                if (isPaused) {
                    Logger.add('[HEALTH] Auto-resuming after recovery timeout');
                    HealthMonitor.resume();
                }
            }, 15000);
        },

        resume: () => {
            if (!isPaused) return;

            Logger.add('[HEALTH] Monitoring resumed');
            isPaused = false;

            if (videoRef) {
                StuckDetector.reset(videoRef);
                FrameDropDetector.reset();
                AVSyncDetector.reset(videoRef);
            }
        }
    };
})();

// --- Stuck Detector ---
/**
 * Detects when video time is not advancing (stuck/frozen playback).
 * @responsibility Monitor video currentTime to detect stuck states.
 */
const StuckDetector = (() => {
    let state = {
        lastTime: 0,
        stuckCount: 0
    };

    const reset = (video = null) => {
        state.lastTime = video ? video.currentTime : 0;
        state.stuckCount = 0;
    };

    const check = (video) => {
        if (!video) return null;
        if (video.paused || video.ended) {
            if (CONFIG.debug && state.stuckCount > 0) {
                Logger.add('StuckDetector[Debug]: Stuck count reset due to paused/ended state.');
            }
            state.stuckCount = 0;
            state.lastTime = video.currentTime;
            return null;
        }

        // Skip if actively buffering (readyState < 3: HAVE_FUTURE_DATA)
        if (video.readyState < 3) {
            if (CONFIG.debug) {
                Logger.add('StuckDetector: Skipping check - buffering', {
                    readyState: video.readyState
                });
            }
            state.stuckCount = 0;
            state.lastTime = video.currentTime;
            return null;
        }

        // Skip if seeking
        if (video.seeking) {
            if (CONFIG.debug) {
                Logger.add('StuckDetector: Skipping check - seeking');
            }
            state.stuckCount = 0;
            state.lastTime = video.currentTime;
            return null;
        }

        const currentTime = video.currentTime;
        const lastTime = state.lastTime;
        const diff = Math.abs(currentTime - lastTime);

        if (CONFIG.debug) {
            Logger.add('StuckDetector[Debug]: Stuck check', {
                currentTime: currentTime.toFixed(3),
                lastTime: lastTime.toFixed(3),
                diff: diff.toFixed(3),
                stuckCount: state.stuckCount,
                threshold: CONFIG.player.STUCK_THRESHOLD_S,
            });
        }

        if (diff < CONFIG.player.STUCK_THRESHOLD_S) {
            state.stuckCount++;
        } else {
            state.stuckCount = 0;
            state.lastTime = currentTime;
        }

        if (state.stuckCount >= CONFIG.player.STUCK_COUNT_LIMIT) {
            Logger.add('[HEALTH] Stuck threshold exceeded', {
                stuckCount: state.stuckCount,
                threshold: CONFIG.player.STUCK_COUNT_LIMIT,
                lastTime,
                currentTime
            });
            return {
                reason: 'Player stuck',
                details: { stuckCount: state.stuckCount, lastTime, currentTime, threshold: CONFIG.player.STUCK_COUNT_LIMIT }
            };
        }

        return null;
    };

    return {
        reset,
        check
    };
})();

// --- Error Classifier ---
/**
 * Classifies errors based on type, message, and known patterns.
 * @responsibility Determine severity and required action for a given error.
 */
const ErrorClassifier = (() => {
    const BENIGN_PATTERNS = ['graphql', 'unauthenticated', 'pinnedchatsettings'];

    return {
        classify: (error, message) => {
            // Critical media errors (always trigger recovery)
            if (error instanceof MediaError || (error && error.code >= 1 && error.code <= 4)) {
                return { severity: 'CRITICAL', action: 'TRIGGER_RECOVERY' };
            }

            // Network errors (usually recoverable)
            if (error instanceof TypeError && message.includes('fetch')) {
                return { severity: 'MEDIUM', action: 'LOG_AND_METRIC' };
            }

            // Known benign errors (log only)
            if (BENIGN_PATTERNS.some(pattern => message.toLowerCase().includes(pattern))) {
                return { severity: 'LOW', action: 'LOG_ONLY' };
            }

            // Unknown errors (log and track)
            return { severity: 'MEDIUM', action: 'LOG_AND_METRIC' };
        }
    };
})();

// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior.
 * REFACTORED: Enhanced logging, longer debounce, smarter recovery triggering.
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;

    // Helper to capture video state for logging
    const getVideoState = () => {
        const video = document.querySelector('video');
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };
        return {
            currentTime: video.currentTime?.toFixed(2),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: video.buffered.length > 0 ?
                `${video.buffered.end(video.buffered.length - 1).toFixed(2)}` : 'empty',
            error: video.error?.code
        };
    };

    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            const classification = classifyError(event.error, event.message || '');

            Logger.add('[INSTRUMENT:ERROR] Global error caught', {
                message: event.message,
                filename: event.filename?.split('/').pop(), // Just filename, not full path
                lineno: event.lineno,
                severity: classification.severity,
                action: classification.action,
                videoState: getVideoState()
            });

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }

            if (classification.action === 'TRIGGER_RECOVERY') {
                Logger.add('[INSTRUMENT:TRIGGER] Error triggering recovery', {
                    errorType: event.error?.name || 'unknown',
                    source: 'GLOBAL_ERROR'
                });
                setTimeout(() => Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'INSTRUMENTATION',
                    trigger: 'GLOBAL_ERROR',
                    reason: event.message
                }), 300);
            }
        });

        window.addEventListener('unhandledrejection', (event) => {
            Logger.add('[INSTRUMENT:REJECTION] Unhandled promise rejection', {
                reason: event.reason ? String(event.reason).substring(0, 200) : 'Unknown',
                severity: 'MEDIUM',
                videoState: getVideoState()
            });
            Metrics.increment('errors');
        });
    };

    // NEW: Capture console.log for timeline correlation
    const interceptConsoleLog = () => {
        const originalLog = console.log;

        console.log = (...args) => {
            originalLog.apply(console, args);
            try {
                // Capture to Logger for merged timeline
                Logger.captureConsole('log', args);
            } catch (e) {
                // Avoid recursion
            }
        };
    };

    const interceptConsoleError = () => {
        const originalError = console.error;

        console.error = (...args) => {
            originalError.apply(console, args);
            try {
                // Capture to Logger for merged timeline
                Logger.captureConsole('error', args);

                const msg = args.map(String).join(' ');
                const classification = classifyError(null, msg);

                Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                    message: msg.substring(0, 300),
                    severity: classification.severity,
                    action: classification.action
                });

                if (classification.action !== 'LOG_ONLY') {
                    Metrics.increment('errors');
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    const interceptConsoleWarn = () => {
        const originalWarn = console.warn;

        // Track stalling detection
        let lastStallDetection = 0;
        let stallCount = 0;

        // INCREASED: 30 second debounce (was 10s) - give player time to self-recover
        const stallingDebounced = Fn.debounce(() => {
            const video = document.querySelector('video');
            const videoState = getVideoState();

            // NEW: Check if player already recovered before triggering
            if (video && !video.paused && video.readyState >= 3) {
                Logger.add('[INSTRUMENT:STALL_RECOVERED] Player recovered before debounce fired', {
                    stallCount,
                    videoState,
                    action: 'SKIPPING_RECOVERY'
                });
                stallCount = 0; // Reset
                return; // Don't trigger recovery - already fixed
            }

            Logger.add('[INSTRUMENT:STALL_TRIGGER] Playhead stalling - triggering recovery', {
                stallCount,
                debounceMs: 30000,
                videoState,
                action: 'EMITTING_AD_DETECTED'
            });

            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                source: 'INSTRUMENTATION',
                trigger: 'PLAYHEAD_STALLING',
                reason: 'Playhead stalled for 30+ seconds',
                details: { stallCount, videoState }
            });

            stallCount = 0; // Reset after trigger
        }, 30000); // INCREASED from 10000

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                // Capture to Logger for merged timeline
                Logger.captureConsole('warn', args);

                const msg = args.map(String).join(' ');

                // Critical playback warning
                if (msg.toLowerCase().includes('playhead stalling')) {
                    stallCount++;
                    const now = Date.now();
                    const timeSinceLast = lastStallDetection ? (now - lastStallDetection) / 1000 : 0;
                    lastStallDetection = now;

                    Logger.add('[INSTRUMENT:STALL_DETECTED] Playhead stalling warning', {
                        stallCount,
                        timeSinceLastStall: timeSinceLast.toFixed(1) + 's',
                        videoState: getVideoState(),
                        debounceActive: true,
                        debounceMs: 30000,
                        originalMessage: msg.substring(0, 100)
                    });

                    stallingDebounced();
                }
                // CSP warnings (informational)
                else if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                    Logger.add('[INSTRUMENT:CSP] CSP warning', {
                        message: msg.substring(0, 200),
                        severity: 'LOW'
                    });
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    return {
        init: () => {
            Logger.add('[INSTRUMENT:INIT] Instrumentation initialized', {
                features: ['globalErrors', 'consoleLogs', 'consoleErrors', 'consoleWarns', 'stallDetection'],
                stallDebounceMs: 30000,
                consoleCapture: true
            });
            setupGlobalErrorHandlers();
            interceptConsoleLog();  // NEW: Capture console.log
            interceptConsoleError();
            interceptConsoleWarn();
        },
    };
})();



// --- Logger ---
/**
 * High-level logging and telemetry export.
 * ENHANCED: Now includes console log capture for timeline correlation.
 */
const Logger = (() => {
    const logs = [];
    const consoleLogs = []; // Captured console.log/warn/error
    const MAX_LOGS = 5000;
    const MAX_CONSOLE_LOGS = 2000;

    const add = (message, detail = null) => {
        if (logs.length >= MAX_LOGS) logs.shift();
        logs.push({
            timestamp: new Date().toISOString(),
            type: 'internal',
            message,
            detail,
        });
    };

    // Capture console output with timestamp
    const captureConsole = (level, args) => {
        if (consoleLogs.length >= MAX_CONSOLE_LOGS) consoleLogs.shift();

        // Convert args to string, truncate long messages
        let message;
        try {
            message = args.map(arg => {
                if (typeof arg === 'string') return arg;
                if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                try { return JSON.stringify(arg); } catch { return String(arg); }
            }).join(' ');

            // Truncate very long messages
            if (message.length > 500) {
                message = message.substring(0, 500) + '... [truncated]';
            }
        } catch (e) {
            message = '[Unable to stringify console args]';
        }

        consoleLogs.push({
            timestamp: new Date().toISOString(),
            type: 'console',
            level, // 'log', 'warn', 'error'
            message,
        });
    };

    // Get merged timeline (our logs + console logs, sorted by timestamp)
    const getMergedTimeline = () => {
        const allLogs = [
            ...logs.map(l => ({ ...l, source: 'SCRIPT' })),
            ...consoleLogs.map(l => ({ ...l, source: 'CONSOLE' }))
        ];

        // Sort by timestamp
        allLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        return allLogs;
    };

    return {
        add,
        captureConsole,
        getLogs: () => logs,
        getConsoleLogs: () => consoleLogs,
        getMergedTimeline,
        init: () => {
            // Console interception is handled by Instrumentation module
        },
        export: () => {
            const metricsSummary = Metrics.getSummary();
            const mergedLogs = getMergedTimeline();
            ReportGenerator.exportReport(metricsSummary, mergedLogs);
        },
    };
})();

// Expose to global scope for user interaction
window.exportTwitchAdLogs = Logger.export;


// --- Metrics ---
/**
 * High-level telemetry and metrics tracking.
 * @responsibility Collects and calculates application metrics.
 */
const Metrics = (() => {
    const counters = {
        ads_detected: 0,
        ads_blocked: 0,
        resilience_executions: 0,
        aggressive_recoveries: 0,
        health_triggers: 0,
        errors: 0,
        session_start: Date.now(),
    };

    const increment = (category, value = 1) => {
        if (counters[category] !== undefined) {
            counters[category] += value;
        }
    };

    const getSummary = () => ({
        ...counters,
        uptime_ms: Date.now() - counters.session_start,
        block_rate: counters.ads_detected > 0 ? (counters.ads_blocked / counters.ads_detected * 100).toFixed(2) + '%' : 'N/A',
    });

    const get = (category) => counters[category] || 0;

    const reset = () => {
        Object.keys(counters).forEach(key => {
            if (key !== 'session_start') counters[key] = 0;
        });
        counters.session_start = Date.now();
    };

    return {
        increment,
        get,
        reset,
        getSummary,
    };
})();

// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report.
 * ENHANCED: Now includes merged timeline of script logs and console output.
 */
const ReportGenerator = (() => {
    const generateContent = (metricsSummary, logs) => {
        // Header with metrics
        const header = `[METRICS]
Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Ads Detected: ${metricsSummary.ads_detected}
Ads Blocked: ${metricsSummary.ads_blocked}
Resilience Executions: ${metricsSummary.resilience_executions}
Aggressive Recoveries: ${metricsSummary.aggressive_recoveries}
Health Triggers: ${metricsSummary.health_triggers}
Errors: ${metricsSummary.errors}

[LEGEND]
🔧 = Script internal log
📋 = Console.log
⚠️ = Console.warn
❌ = Console.error

[TIMELINE - Merged script + console logs]
`;

        // Format each log entry based on source and type
        const logContent = logs.map(l => {
            const time = l.timestamp;

            if (l.source === 'CONSOLE' || l.type === 'console') {
                // Console log entry
                const icon = l.level === 'error' ? '❌' : l.level === 'warn' ? '⚠️' : '📋';
                return `[${time}] ${icon} ${l.message}`;
            } else {
                // Internal script log
                const detail = l.detail ? ' | ' + JSON.stringify(l.detail) : '';
                return `[${time}] 🔧 ${l.message}${detail}`;
            }
        }).join('\n');

        // Stats about what was captured
        const scriptLogs = logs.filter(l => l.source === 'SCRIPT' || l.type === 'internal').length;
        const consoleLogs = logs.filter(l => l.source === 'CONSOLE' || l.type === 'console').length;

        const footer = `

[CAPTURE STATS]
Script logs: ${scriptLogs}
Console logs: ${consoleLogs}
Total entries: ${logs.length}
`;

        return header + logContent + footer;
    };

    const downloadFile = (content) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `twitch_ad_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return {
        exportReport: (metricsSummary, logs) => {
            Logger.add("Generating and exporting report...");
            const content = generateContent(metricsSummary, logs);
            downloadFile(content);
        },
    };
})();


// --- Store ---
/**
 * Persistent state management using localStorage.
 * @typedef {Object} State
 * @property {number} errorCount - Consecutive error counter.
 * @property {number} timestamp - Last update timestamp.
 * @property {string|null} lastError - Last error message.
 * @property {number} lastAttempt - Timestamp of last injection attempt.
 */
const Store = (() => {
    let state = { errorCount: 0, timestamp: 0, lastError: null, lastAttempt: 0 };

    const hydrate = Fn.pipe(
        Adapters.Storage.read,
        (json) => {
            if (!json) return null;
            try {
                return JSON.parse(json);
            } catch (e) {
                Logger.add('Store hydration failed - corrupt data', { error: e.message });
                return null;
            }
        },
        (data) => (data && Date.now() - data.timestamp <= CONFIG.timing.LOG_EXPIRY_MIN * 60 * 1000) ? data : null
    );

    const hydrated = hydrate('MAD_STATE');
    if (hydrated) state = { ...state, ...hydrated };

    return {
        get: () => state,
        update: (partial) => {
            state = { ...state, ...partial, timestamp: Date.now() };
            Adapters.Storage.write('MAD_STATE', state);
        }
    };
})();

// --- AdBlocker ---
/**
 * Handles the decision logic for detecting ads and triggers.
 * @responsibility
 * 1. Check URLs against ad patterns.
 * 2. Emit AD_DETECTED only for actual ad delivery (not availability checks).
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
    // Correlation tracking
    let lastAdDetectionTime = 0; // Kept for local fallback/legacy support

    const process = (url, type) => {
        // 1. Input Validation
        if (!url || typeof url !== 'string') {
            Logger.debug('[NETWORK] Invalid URL passed to AdBlocker', { url, type });
            return false;
        }

        // 2. Pattern Discovery (Always run)
        Logic.Network.detectNewPatterns(url);

        let isAd = false;
        let isTrigger = false;

        // 3. Check Trigger First (Subset of Ads)
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
                if (typeof AdAnalytics !== 'undefined') {
                    AdAnalytics.trackDetection();
                }
                lastAdDetectionTime = Date.now();

                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'NETWORK',
                    trigger: 'AD_DELIVERY',
                    reason: 'Ad delivery pattern matched',
                    details: { url, type }
                });
            }
        }
        // 4. Check Generic Ad (if not already identified as trigger)
        else if (Logic.Network.isAd(url)) {
            isAd = true;
            Logger.add('[NETWORK] Ad pattern detected', { type, url });
        }

        // 5. Unified Metrics
        if (isAd) {
            Metrics.increment('ads_detected');

            // NEW: Record for correlation tracking
            if (typeof AdCorrelation !== 'undefined') {
                AdCorrelation.recordBlock(url, type);
            }
        }

        return isAd;
    };

    // Listen for health-triggered recoveries to detect missed ads
    const initCorrelationTracking = () => {
        if (typeof AdAnalytics !== 'undefined') {
            AdAnalytics.init();
        } else {
            Logger.debug('[NETWORK] AdAnalytics module not loaded, skipping correlation tracking');
        }
    };

    return {
        process,
        init: initCorrelationTracking,

        // Delegate stats to AdAnalytics if available
        getCorrelationStats: () => {
            if (typeof AdAnalytics !== 'undefined') {
                return AdAnalytics.getCorrelationStats();
            }
            return { error: 'AdAnalytics not loaded' };
        }
    };
})();

// --- Ad Correlation ---
/**
 * Tracks correlation between blocked ad requests and player health.
 * Helps measure effectiveness of ad blocking.
 */
const AdCorrelation = (() => {
    const recentBlocks = [];
    const MAX_HISTORY = 50;
    const CORRELATION_WINDOW_MS = 10000; // 10 seconds

    /**
     * Records a blocked ad request
     * @param {string} url - The blocked URL
     * @param {string} type - Request type (XHR/FETCH)
     */
    const recordBlock = (url, type) => {
        const record = {
            url: url.substring(0, 100), // Truncate for memory
            type,
            timestamp: Date.now(),
            playerHealthy: null // Will be updated by health checks
        };

        recentBlocks.push(record);

        // Trim old entries
        while (recentBlocks.length > MAX_HISTORY) {
            recentBlocks.shift();
        }

        Logger.add('[AdCorrelation] Block recorded', {
            type,
            urlPreview: url.substring(0, 80),
            totalBlocked: recentBlocks.length
        });
    };

    /**
     * Updates player health state for recent blocks
     * @param {boolean} isHealthy - Current player health state
     */
    const updatePlayerState = (isHealthy) => {
        const now = Date.now();
        let updated = 0;

        recentBlocks.forEach(block => {
            if (now - block.timestamp < CORRELATION_WINDOW_MS && block.playerHealthy === null) {
                block.playerHealthy = isHealthy;
                updated++;
            }
        });

        if (updated > 0) {
            Logger.add('[AdCorrelation] Player state updated for recent blocks', {
                isHealthy,
                blocksUpdated: updated
            });
        }
    };

    /**
     * Gets correlation statistics
     * @returns {Object} Stats about blocking effectiveness
     */
    const getStats = () => {
        const total = recentBlocks.length;
        const healthy = recentBlocks.filter(b => b.playerHealthy === true).length;
        const unhealthy = recentBlocks.filter(b => b.playerHealthy === false).length;
        const pending = recentBlocks.filter(b => b.playerHealthy === null).length;

        const stats = {
            totalBlocked: total,
            playerRemainedHealthy: healthy,
            playerBecameUnhealthy: unhealthy,
            pendingCorrelation: pending,
            effectivenessRate: total > 0 && (healthy + unhealthy) > 0
                ? ((healthy / (healthy + unhealthy)) * 100).toFixed(1) + '%'
                : 'N/A'
        };

        return stats;
    };

    /**
     * Exports full correlation data for analysis
     */
    const exportData = () => {
        const stats = getStats();
        Logger.add('[AdCorrelation] Correlation Export', {
            ...stats,
            recentBlocks: recentBlocks.slice(-10) // Last 10 for log
        });
        return {
            stats,
            blocks: [...recentBlocks]
        };
    };

    return {
        recordBlock,
        updatePlayerState,
        getStats,
        exportData
    };
})();

// --- Diagnostics ---
/**
 * Handles network traffic logging and diagnostics.
 * ENHANCED: Always logs video-related requests for debugging stream issues.
 */
const Diagnostics = (() => {
    // Track video request activity
    let lastVideoRequestTime = 0;
    let videoRequestCount = 0;
    let m3u8RequestCount = 0;

    const logNetworkRequest = (url, type, isAd) => {
        if (isAd) {
            // Always log blocked ads
            Logger.add('[NETWORK:BLOCKED] Ad request blocked', { type, url: url.substring(0, 100) });
            return;
        }

        const urlLower = url.toLowerCase();

        // ALWAYS log video-related requests (m3u8, video segments)
        const isM3U8 = urlLower.includes('.m3u8');
        const isVideoSegment = urlLower.includes('video-weaver') ||
            urlLower.includes('video-edge') ||
            urlLower.includes('.ts') ||
            urlLower.includes('segment');

        if (isM3U8) {
            m3u8RequestCount++;
            lastVideoRequestTime = Date.now();
            Logger.add('[NETWORK:M3U8] Manifest request', {
                type,
                url: url.substring(0, 150),
                totalM3U8: m3u8RequestCount
            });
            return;
        }

        if (isVideoSegment) {
            videoRequestCount++;
            lastVideoRequestTime = Date.now();
            // Log every 10th segment to avoid spam, but always log first few
            if (videoRequestCount <= 5 || videoRequestCount % 10 === 0) {
                Logger.add('[NETWORK:SEGMENT] Video segment request', {
                    type,
                    url: url.substring(0, 100),
                    segmentCount: videoRequestCount
                });
            }
            return;
        }

        // Sample other Twitch/ttvnw requests at 10%
        const isRelevant = urlLower.includes('twitch') || urlLower.includes('ttvnw');
        if (isRelevant && Math.random() < 0.10) {
            Logger.add('[NETWORK:OTHER] Request', { type, url: url.substring(0, 100) });
        }
    };

    // Helper to check video stream health
    const getVideoStreamStats = () => ({
        lastVideoRequestMs: lastVideoRequestTime ? Date.now() - lastVideoRequestTime : null,
        videoSegments: videoRequestCount,
        manifests: m3u8RequestCount
    });

    return {
        logNetworkRequest,
        getVideoStreamStats
    };
})();


// --- Mocking ---
/**
 * Handles the creation and application of mock responses for blocked requests.
 * @responsibility
 * 1. Generate mock responses for XHR and Fetch.
 * 2. Apply mocks to XHR objects.
 */
const Mocking = (() => {
    /**
     * Mocks a response for a blocked XHR ad request.
     * !CRITICAL: Mocking responses is essential. If we just block the request,
     * the player will retry indefinitely or crash. We must return a valid,
     * empty response to satisfy the player's state machine.
     * @param {XMLHttpRequest} xhr The XHR object to mock.
     * @param {string} url The URL of the request.
     */
    const mockXhrResponse = (xhr, url) => {
        const { body } = Logic.Network.getMock(url);
        Logger.add('Ad request blocked (XHR)', { url });
        Metrics.increment('ads_blocked');

        Object.defineProperties(xhr, {
            readyState: { value: 4, writable: false },
            responseText: { value: body, writable: false },
            response: { value: body, writable: false },
            status: { value: 200, writable: false },
            statusText: { value: 'OK', writable: false },
        });

        queueMicrotask(() => {
            if (xhr.onreadystatechange) xhr.onreadystatechange();
            if (xhr.onload) xhr.onload();
        });
    };

    const getFetchMock = (url) => {
        const { body, type } = Logic.Network.getMock(url);
        Logger.add('Ad request blocked (FETCH)', { url });
        Metrics.increment('ads_blocked');
        return new Response(body, {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': type },
        });
    };

    return {
        mockXhrResponse,
        getFetchMock
    };
})();

// --- Network Manager ---
/**
 * Orchestrates the hooking of XMLHttpRequest and fetch, delegating tasks to sub-modules.
 * @responsibility
 * 1. Hook XHR and Fetch.
 * 2. Delegate ad detection to AdBlocker.
 * 3. Delegate logging to Diagnostics.
 * 4. Delegate mocking to Mocking.
 */
const NetworkManager = (() => {
    const hookXHR = () => {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            if (method === 'GET' && typeof url === 'string') {
                const isAd = AdBlocker.process(url, 'XHR');

                // Auto-detect potential new patterns
                Logic.Network.detectNewPatterns(url);

                Diagnostics.logNetworkRequest(url, 'XHR', isAd);
                if (isAd) {
                    this._isAdRequest = true;
                }
            }
            originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            if (this._isAdRequest) {
                Mocking.mockXhrResponse(this, this._responseURL);
                return;
            }
            originalSend.apply(this, arguments);
        };
    };

    const hookFetch = () => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
            const url = (typeof input === 'string') ? input : input.url;
            if (url) {
                const isAd = AdBlocker.process(url, 'FETCH');

                // Auto-detect potential new patterns
                Logic.Network.detectNewPatterns(url);

                Diagnostics.logNetworkRequest(url, 'FETCH', isAd);
                if (isAd) {
                    return Promise.resolve(Mocking.getFetchMock(url));
                }
            }
            return originalFetch(input, init);
        };
    };

    return {
        init: () => {
            hookXHR();
            hookFetch();
        },
    };
})();

// --- Pattern Updater ---
/**
 * Fetches and manages dynamic ad patterns from external sources.
 * Works ALONGSIDE existing static patterns - additive, not replacement.
 */
const PatternUpdater = (() => {
    // Community pattern sources (add your own GitHub gist, raw URL, etc.)
    const PATTERN_SOURCES = [
        // Example: 'https://raw.githubusercontent.com/user/repo/main/patterns.json'
        // Example: 'https://gist.githubusercontent.com/user/id/raw/patterns.json'
    ];

    // EMBEDDED FALLBACK PATTERNS - always available even without remote source
    const EMBEDDED_PATTERNS = [
        { type: 'string', value: '/api/ads/' },
        { type: 'string', value: 'amazon-adsystem.com' },
        { type: 'string', value: 'imasdk.googleapis.com' },
        { type: 'regex', value: '\\/ad[s]?\\/v\\d+\\/', flags: 'i' },
        { type: 'regex', value: 'preroll|midroll|postroll', flags: 'i' },
        { type: 'string', value: 'video-ad-' },
        { type: 'string', value: '/commercial/' },
        { type: 'string', value: 'adserver.' },
        { type: 'regex', value: '\\.ads?\\.', flags: 'i' },
    ];

    const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // Refresh every 6 hours
    let lastUpdate = 0;
    let dynamicPatterns = [...EMBEDDED_PATTERNS]; // Start with embedded patterns
    let isInitialized = false;
    let fetchInProgress = false;

    /**
     * Fetches patterns from configured sources
     * @returns {Promise<boolean>} True if successful
     */
    const fetchPatterns = async () => {
        if (fetchInProgress) {
            Logger.add('[PatternUpdater] Fetch already in progress, skipping');
            return false;
        }

        if (PATTERN_SOURCES.length === 0) {
            Logger.add('[PatternUpdater] No pattern sources configured');
            return false;
        }

        fetchInProgress = true;
        Logger.add('[PatternUpdater] Fetching patterns...', {
            sourceCount: PATTERN_SOURCES.length,
            lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : 'never'
        });

        for (const source of PATTERN_SOURCES) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(source, {
                    cache: 'no-cache',
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    Logger.add('[PatternUpdater] Source returned non-OK', {
                        source: source.substring(0, 50),
                        status: response.status
                    });
                    continue;
                }

                const data = await response.json();

                if (data.patterns && Array.isArray(data.patterns)) {
                    const oldCount = dynamicPatterns.length;
                    dynamicPatterns = data.patterns;
                    lastUpdate = Date.now();

                    Logger.add('[PatternUpdater] Patterns updated successfully', {
                        newCount: dynamicPatterns.length,
                        previousCount: oldCount,
                        version: data.version || 'unknown',
                        source: source.substring(0, 50)
                    });

                    fetchInProgress = false;
                    return true;
                } else {
                    Logger.add('[PatternUpdater] Invalid pattern format', {
                        source: source.substring(0, 50),
                        hasPatterns: !!data.patterns,
                        isArray: Array.isArray(data.patterns)
                    });
                }
            } catch (e) {
                Logger.add('[PatternUpdater] Fetch failed', {
                    source: source.substring(0, 50),
                    error: e.name,
                    message: e.message
                });
            }
        }

        Logger.add('[PatternUpdater] All sources failed or returned invalid data');
        fetchInProgress = false;
        return false;
    };

    /**
     * Checks if URL matches any dynamic pattern
     * @param {string} url - URL to check
     * @returns {boolean} True if matches
     */
    const matchesDynamic = (url) => {
        if (!url || dynamicPatterns.length === 0) return false;

        for (const pattern of dynamicPatterns) {
            let matched = false;

            try {
                if (pattern.type === 'regex') {
                    matched = new RegExp(pattern.value, pattern.flags || 'i').test(url);
                } else {
                    // Default to string match
                    matched = url.includes(pattern.value);
                }
            } catch (e) {
                Logger.add('[PatternUpdater] Pattern match error', {
                    pattern: pattern.value,
                    error: e.message
                });
                continue;
            }

            if (matched) {
                Logger.add('[PatternUpdater] Dynamic pattern matched', {
                    url: url.substring(0, 100),
                    patternValue: pattern.value,
                    patternType: pattern.type || 'string'
                });
                return true;
            }
        }
        return false;
    };

    /**
     * Initialize - fetches patterns immediately on load
     */
    const init = () => {
        if (isInitialized) {
            Logger.add('[PatternUpdater] Already initialized');
            return;
        }
        isInitialized = true;

        Logger.add('[PatternUpdater] Initializing', {
            embeddedPatterns: EMBEDDED_PATTERNS.length,
            remoteSourceCount: PATTERN_SOURCES.length,
            refreshIntervalHours: REFRESH_INTERVAL_MS / (60 * 60 * 1000)
        });

        // Fetch from remote sources if configured (embedded patterns already loaded)
        if (PATTERN_SOURCES.length > 0) {
            fetchPatterns();
        } else {
            Logger.add('[PatternUpdater] Using embedded patterns only (no remote sources)');
        }

        // Periodic refresh check - only if sources exist
        if (PATTERN_SOURCES.length > 0) {
            setInterval(() => {
                if (Date.now() - lastUpdate > REFRESH_INTERVAL_MS) {
                    Logger.add('[PatternUpdater] Periodic refresh triggered');
                    fetchPatterns();
                }
            }, 60000); // Check every minute if refresh needed
        }
    };

    /**
     * Adds a pattern source URL
     * @param {string} url - Source URL to add
     */
    const addSource = (url) => {
        if (url && !PATTERN_SOURCES.includes(url)) {
            PATTERN_SOURCES.push(url);
            Logger.add('[PatternUpdater] Source added', { url: url.substring(0, 50) });
        }
    };

    return {
        init,
        matchesDynamic,
        addSource,
        forceUpdate: fetchPatterns,
        getPatterns: () => [...dynamicPatterns],
        getStats: () => ({
            patternCount: dynamicPatterns.length,
            lastUpdate: lastUpdate ? new Date(lastUpdate).toISOString() : 'never',
            isInitialized,
            sourceCount: PATTERN_SOURCES.length
        })
    };
})();

// --- Player Context ---
/**
 * React/Vue internal state scanner.
 * @responsibility Finds the internal React/Vue component instance associated with the DOM element.
 */
const PlayerContext = (() => {
    let cachedContext = null;
    let cachedRootElement = null;
    const contextHintKeywords = ['react', 'vue', 'next', 'props', 'fiber', 'internal'];

    /**
     * Resets the cache and signature detector
     */
    const reset = () => {
        cachedContext = null;
        cachedRootElement = null;
        SignatureDetector.reset();
    };

    /**
     * Get player context for a DOM element
     * @param {HTMLElement} element - Player container element
     * @returns {Object|null} Player context object, or null if not found
     */
    const get = (element) => {
        // Check if element is different from cached root
        if (element && cachedRootElement && element !== cachedRootElement) {
            Logger.add('PlayerContext: New element provided, resetting cache');
            reset();
        }

        if (ContextValidator.validateCache(cachedContext, cachedRootElement)) {
            return cachedContext;
        }
        if (!element) return null;

        // 1. Primary Strategy: Keyword Search on Root Element
        const keys = Reflect.ownKeys(element);

        for (const key of keys) {
            const keyString = String(key).toLowerCase();
            if (contextHintKeywords.some(hint => keyString.includes(hint))) {
                const potentialContext = element[key];
                if (potentialContext && typeof potentialContext === 'object') {
                    const ctx = ContextTraverser.traverseForPlayerContext(potentialContext);
                    if (ctx) {
                        cachedContext = ctx;
                        cachedRootElement = element;
                        Logger.add('PlayerContext: Success', { method: 'keyword', key: String(key) });
                        return ctx;
                    }
                }
            }
        }

        // 2. Fallback Strategy: DOM Selectors
        const fallbackResult = ContextTraverser.findContextFallback();
        if (fallbackResult) {
            cachedContext = fallbackResult.ctx;
            cachedRootElement = fallbackResult.element;
            Logger.add('PlayerContext: Success', { method: 'fallback', element: fallbackResult.element });
            return fallbackResult.ctx;
        }

        Logger.add('PlayerContext: Scan failed - no context found');
        return null;
    };

    return {
        get,
        reset
    };
})();

// --- Player Patcher ---
/**
 * Experimental: Hooks into Twitch player internals to intercept ad methods.
 * DISABLED by default - enable via CONFIG.experimental.ENABLE_PLAYER_PATCHING
 * 
 * @warning This is intrusive and could be detected by Twitch.
 */
const PlayerPatcher = (() => {
    let enabled = false;
    let patchApplied = false;
    let patchedMethods = [];
    let interceptedCalls = 0;

    // Fuzzy patterns for ad-related method names
    const AD_METHOD_PATTERNS = [
        /^(play|show|display|start|trigger|fire|load|queue)ad/i,
        /ad(play|start|begin|load|queue|show)$/i,
        /^on(ad|commercial|preroll|midroll)/i,
        /(ad|commercial|sponsor)(handler|manager|controller)/i,
        /^(preroll|midroll|postroll)/i,
        /commercial(break|start|end)/i
    ];

    /**
     * Check if a method name looks like an ad handler
     * @param {string} name - Method name to check
     * @returns {boolean} True if matches ad patterns
     */
    const looksLikeAdMethod = (name) => {
        if (!name || typeof name !== 'string') return false;
        return AD_METHOD_PATTERNS.some(pattern => pattern.test(name));
    };

    /**
     * Recursively scan object for ad-like methods
     * @param {Object} obj - Object to scan
     * @param {number} depth - Current recursion depth
     * @param {string} path - Current path for logging
     * @returns {Array} Found ad methods
     */
    const findAdMethods = (obj, depth = 0, path = '') => {
        if (!obj || typeof obj !== 'object' || depth > 3) return [];

        const found = [];

        try {
            const keys = Object.keys(obj);

            for (const key of keys) {
                const fullPath = path ? `${path}.${key}` : key;

                try {
                    const value = obj[key];

                    if (typeof value === 'function' && looksLikeAdMethod(key)) {
                        found.push({ name: key, path: fullPath, obj, fn: value });
                        Logger.add('[PlayerPatcher] Found potential ad method', {
                            method: key,
                            path: fullPath,
                            depth
                        });
                    }

                    // Recurse into nested objects (but not functions/DOM/etc)
                    if (typeof value === 'object' &&
                        value !== null &&
                        !(value instanceof HTMLElement) &&
                        !(value instanceof Window)) {
                        found.push(...findAdMethods(value, depth + 1, fullPath));
                    }
                } catch (e) {
                    // Skip inaccessible properties
                }
            }
        } catch (e) {
            Logger.add('[PlayerPatcher] Scan error', { path, error: e.message });
        }

        return found;
    };

    /**
     * Apply patches to intercept ad methods
     * @param {Object} playerContext - Player context from PlayerContext.get()
     */
    const applyPatch = (playerContext) => {
        if (!enabled) {
            Logger.add('[PlayerPatcher] Not enabled, skipping patch');
            return;
        }

        if (patchApplied) {
            Logger.add('[PlayerPatcher] Patch already applied');
            return;
        }

        if (!playerContext) {
            Logger.add('[PlayerPatcher] No player context provided');
            return;
        }

        Logger.add('[PlayerPatcher] Starting scan for ad methods...', {
            contextKeys: Object.keys(playerContext).length
        });

        try {
            const player = playerContext.player || playerContext;
            const adMethods = findAdMethods(player);

            Logger.add('[PlayerPatcher] Scan complete', {
                methodsFound: adMethods.length,
                methods: adMethods.map(m => m.path)
            });

            if (adMethods.length === 0) {
                Logger.add('[PlayerPatcher] No ad methods found to patch');
                return;
            }

            for (const { name, path, obj, fn } of adMethods) {
                try {
                    const original = fn.bind(obj);

                    obj[name] = function (...args) {
                        interceptedCalls++;
                        Logger.add('[PlayerPatcher] INTERCEPTED ad method call', {
                            method: name,
                            path,
                            callNumber: interceptedCalls,
                            argCount: args.length
                        });

                        // Return a resolved promise to satisfy any await
                        return Promise.resolve({
                            skipped: true,
                            method: name,
                            interceptedBy: 'PlayerPatcher'
                        });
                    };

                    patchedMethods.push({ name, path });
                    Logger.add('[PlayerPatcher] Patched method successfully', {
                        method: name,
                        path
                    });
                } catch (e) {
                    Logger.add('[PlayerPatcher] Failed to patch method', {
                        method: name,
                        path,
                        error: e.message
                    });
                }
            }

            // Intercept addEventListener for ad events
            if (typeof player.addEventListener === 'function') {
                const originalAddEventListener = player.addEventListener.bind(player);

                player.addEventListener = function (event, handler, options) {
                    if (/ad|commercial|preroll|midroll|sponsor/i.test(event)) {
                        Logger.add('[PlayerPatcher] Blocked ad event listener', {
                            event,
                            blocked: true
                        });
                        return; // Don't add ad-related listeners
                    }
                    return originalAddEventListener(event, handler, options);
                };

                Logger.add('[PlayerPatcher] Patched addEventListener');
                patchedMethods.push({ name: 'addEventListener', path: 'player.addEventListener' });
            }

            patchApplied = true;
            Logger.add('[PlayerPatcher] Patch complete', {
                totalPatched: patchedMethods.length,
                methods: patchedMethods.map(m => m.name)
            });

        } catch (e) {
            Logger.add('[PlayerPatcher] Patch failed with error', {
                error: e.name,
                message: e.message,
                stack: e.stack?.substring(0, 200)
            });
        }
    };

    /**
     * Enable the patcher
     */
    const enable = () => {
        enabled = true;
        Logger.add('[PlayerPatcher] Enabled');
    };

    /**
     * Disable the patcher
     */
    const disable = () => {
        enabled = false;
        Logger.add('[PlayerPatcher] Disabled');
    };

    /**
     * Reset patch state (for re-patching after player remount)
     */
    const reset = () => {
        patchApplied = false;
        patchedMethods = [];
        interceptedCalls = 0;
        Logger.add('[PlayerPatcher] Reset');
    };

    return {
        enable,
        disable,
        isEnabled: () => enabled,
        apply: applyPatch,
        reset,
        getStats: () => ({
            enabled,
            patchApplied,
            patchedMethodCount: patchedMethods.length,
            patchedMethods: patchedMethods.map(m => m.name),
            interceptedCalls
        })
    };
})();

// --- Video Listener Manager ---
/**
 * Manages event listeners on the video element to detect stream changes and performance issues.
 */
const VideoListenerManager = (() => {
    let activeElement = null;

    // Diagnostic handlers to detect sync/performance issues
    const handlers = {
        loadstart: () => Adapters.EventBus.emit(CONFIG.events.ACQUIRE),
        waiting: () => Logger.add('Video Event: waiting', { currentTime: activeElement?.currentTime }),
        stalled: () => Logger.add('Video Event: stalled', { currentTime: activeElement?.currentTime }),
        ratechange: () => Logger.add('Video Event: ratechange', { rate: activeElement?.playbackRate, currentTime: activeElement?.currentTime }),
        seeked: () => Logger.add('Video Event: seeked', { currentTime: activeElement?.currentTime }),
        resize: () => Logger.add('Video Event: resize', { width: activeElement?.videoWidth, height: activeElement?.videoHeight }),
        error: () => {
            const video = activeElement;
            if (!video) return;

            const error = video.error;
            const errorDetails = {
                code: error ? error.code : null,
                message: error ? error.message : 'Unknown error',
                readyState: video.readyState,
                networkState: video.networkState,
                currentTime: video.currentTime,
                src: video.src || '(empty)',
                currentSrc: video.currentSrc || '(empty)'
            };

            Logger.add('Video Event: ERROR - Player crashed', errorDetails);
            Metrics.increment('errors');

            // Error code 4 = MEDIA_ELEMENT_ERROR: Format error / Not supported
            // This often indicates the player is in an unrecoverable state
            if (error && (error.code === CONFIG.codes.MEDIA_ERROR_SRC || (window.MediaError && error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED))) {
                Logger.add('Player error #4000 or similar - player in unrecoverable state', {
                    errorCode: error.code,
                    needsRecovery: true
                });

                // Trigger recovery attempt after a short delay to let error state settle
                setTimeout(() => {
                    if (Core.activeContainer && document.body.contains(video)) {
                        Logger.add('Attempting recovery from player error');
                        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                    }
                }, 500);
            }
        }
    };

    return {
        attach: (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            if (activeElement === video) return;

            if (activeElement) VideoListenerManager.detach();

            activeElement = video;

            Object.entries(handlers).forEach(([event, handler]) => {
                activeElement.addEventListener(event, handler);
            });
        },
        detach: () => {
            if (activeElement) {
                Object.entries(handlers).forEach(([event, handler]) => {
                    activeElement.removeEventListener(event, handler);
                });
            }
            activeElement = null;
        }
    };
})();

// --- Aggressive Recovery ---
/**
 * Stream refresh recovery strategy with escalating interventions.
 * @responsibility Force stream refresh when standard recovery fails.
 */
const AggressiveRecovery = (() => {
    const READY_CHECK_INTERVAL_MS = 100;

    /**
     * Attempts to toggle quality to force stream refresh
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if quality toggle was attempted
     */
    const attemptQualityToggle = (video) => {
        try {
            // Find Twitch's React player instance
            const container = video.closest('.video-player');
            if (!container) return false;

            // Look for quality selector button
            const settingsBtn = container.querySelector('[data-a-target="player-settings-button"]');
            if (settingsBtn) {
                // Click settings to open menu
                settingsBtn.click();

                // Short delay then look for quality option
                setTimeout(() => {
                    const qualityBtn = container.querySelector('[data-a-target="player-settings-menu-item-quality"]');
                    if (qualityBtn) {
                        qualityBtn.click();
                        Logger.add('[Aggressive] Quality menu opened - user can select quality to refresh');
                    }
                    // Close menu after a moment
                    setTimeout(() => settingsBtn.click(), 500);
                }, 100);

                return true;
            }
        } catch (e) {
            Logger.add('[Aggressive] Quality toggle failed', { error: e.message });
        }
        return false;
    };

    return {
        name: 'AggressiveRecovery',

        execute: async (video) => {
            Metrics.increment('aggressive_recoveries');
            Logger.add('Executing aggressive recovery: escalating interventions');
            const recoveryStartTime = performance.now();

            // Log initial telemetry
            const initialState = RecoveryUtils.captureVideoState(video);
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            Logger.add('Aggressive recovery telemetry', {
                strategy: 'ESCALATING',
                url: originalSrc,
                isBlobUrl,
                telemetry: initialState
            });

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;

            // STRATEGY 1: Pause/Resume cycle (can reset internal player state)
            Logger.add('[Aggressive] Strategy 1: Pause/Resume cycle');
            try {
                video.pause();
                await Fn.sleep(100);
                await video.play();
                await Fn.sleep(300);

                if (!video.paused && video.readyState >= 3) {
                    Logger.add('[Aggressive] Pause/Resume successful');
                    return;
                }
            } catch (e) {
                Logger.add('[Aggressive] Pause/Resume failed', { error: e.message });
            }

            // STRATEGY 2: Jump to buffer end (live edge)
            Logger.add('[Aggressive] Strategy 2: Jump to live edge');
            if (video.buffered.length > 0) {
                try {
                    const bufferEnd = video.buffered.end(video.buffered.length - 1);
                    // Jump to 0.5s before buffer end for safety margin
                    const target = Math.max(video.currentTime, bufferEnd - 0.5);

                    await new Promise((resolve) => {
                        const onSeeked = () => {
                            video.removeEventListener('seeked', onSeeked);
                            resolve();
                        };
                        const timeout = setTimeout(() => {
                            video.removeEventListener('seeked', onSeeked);
                            resolve();
                        }, 1000);
                        video.addEventListener('seeked', () => {
                            clearTimeout(timeout);
                            onSeeked();
                        }, { once: true });
                        video.currentTime = target;
                    });

                    await Fn.sleep(200);
                    if (!video.paused && video.readyState >= 3) {
                        Logger.add('[Aggressive] Jump to live edge successful', { target: target.toFixed(3) });
                        return;
                    }
                } catch (e) {
                    Logger.add('[Aggressive] Jump to live edge failed', { error: e.message });
                }
            }

            // STRATEGY 3: Attempt quality toggle (forces stream refresh)
            Logger.add('[Aggressive] Strategy 3: Quality toggle attempt');
            attemptQualityToggle(video);

            await Fn.sleep(500);
            if (!video.paused && video.readyState >= 3) {
                Logger.add('[Aggressive] Quality toggle successful');
            } else {
                // STRATEGY 4: Force source reload (last resort)
                Logger.add('[Aggressive] Strategy 4: Source reload attempt');
                try {
                    const currentSrc = video.src;
                    const isBlobSrc = currentSrc && currentSrc.startsWith('blob:');

                    Logger.add('[Aggressive] Source reload state', {
                        hasSrc: !!currentSrc,
                        isBlobSrc,
                        readyState: video.readyState,
                        networkState: video.networkState
                    });

                    if (currentSrc && !isBlobSrc) {
                        // For non-blob sources, reload directly
                        video.src = '';
                        await Fn.sleep(100);
                        video.src = currentSrc;
                        video.load();
                        Logger.add('[Aggressive] Source reloaded directly');
                        await Fn.sleep(500);
                        await video.play().catch(e =>
                            Logger.add('[Aggressive] Play after reload failed', { error: e.message })
                        );
                    } else {
                        // For blob sources, trigger Twitch player refresh via keyboard
                        const container = video.closest('.video-player');
                        if (container) {
                            // Simulate 'r' key which refreshes stream in Twitch
                            container.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'r',
                                code: 'KeyR',
                                bubbles: true
                            }));
                            Logger.add('[Aggressive] Triggered keyboard refresh (R key)');
                            await Fn.sleep(1000);
                        }
                    }

                    // Check if reload worked
                    const postReloadState = {
                        paused: video.paused,
                        readyState: video.readyState,
                        networkState: video.networkState
                    };
                    Logger.add('[Aggressive] Post-reload state', postReloadState);

                    if (!video.paused && video.readyState >= 3) {
                        Logger.add('[Aggressive] Source reload SUCCESSFUL');
                    } else {
                        Logger.add('[Aggressive] Source reload FAILED - player still unhealthy');
                    }
                } catch (e) {
                    Logger.add('[Aggressive] Source reload error', { error: e.message });
                }
            }

            // Wait for stream to stabilize
            await RecoveryUtils.waitForStability(video, {
                startTime: recoveryStartTime,
                timeoutMs: CONFIG.timing.PLAYBACK_TIMEOUT_MS,
                checkIntervalMs: READY_CHECK_INTERVAL_MS
            });

            // Restore video state
            try {
                video.playbackRate = playbackRate;
                video.volume = volume;
                video.muted = muted;
            } catch (e) {
                Logger.add('[Aggressive] Failed to restore video state', { error: e.message });
            }

            // FINAL PLAY ATTEMPT - Safety net if still paused
            if (video.paused) {
                Logger.add('[Aggressive] Final play attempt - video still paused after all strategies', {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    currentTime: video.currentTime.toFixed(3)
                });
                try {
                    await video.play();
                    await Fn.sleep(200);
                    Logger.add('[Aggressive] Final play result', {
                        success: !video.paused,
                        paused: video.paused,
                        readyState: video.readyState
                    });
                } catch (e) {
                    Logger.add('[Aggressive] Final play failed', {
                        error: e.name,
                        message: e.message
                    });
                }
            }

            const duration = performance.now() - recoveryStartTime;
            Logger.add('[Aggressive] Recovery complete', {
                duration: duration.toFixed(0) + 'ms',
                finalPaused: video.paused,
                finalState: RecoveryUtils.captureVideoState(video)
            });

            // Export correlation stats on recovery completion
            if (typeof AdCorrelation !== 'undefined') {
                Logger.add('[Aggressive] Ad correlation stats', AdCorrelation.getStats());
            }
        }
    };
})();


/**
 * Specialized recovery strategy for A/V synchronization issues.
 * Implements a graduated approach to minimize user disruption while ensuring fix.
 */
const AVSyncRecovery = (() => {
    const classifySeverity = (discrepancyMs) => {
        if (discrepancyMs < 1000) return RecoveryConstants.SEVERITY.MINOR;
        if (discrepancyMs < 3000) return RecoveryConstants.SEVERITY.MODERATE;
        if (discrepancyMs < 10000) return RecoveryConstants.SEVERITY.SEVERE;
        return RecoveryConstants.SEVERITY.CRITICAL;
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const level2_pauseResume = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 2: Pause/Resume attempt');
        try {
            video.pause();
            await sleep(500); // Allow decoders to stabilize
            await video.play();
            return { level: 2, success: true, remainingDesync: 0 }; // Assume fixed for now, verification happens next cycle
        } catch (e) {
            Logger.add('[AV_SYNC] Level 2 failed', { error: e.message });
            return { level: 2, success: false, remainingDesync: discrepancy };
        }
    };

    const level3_seek = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 3: Seek to current position');
        try {
            const pos = video.currentTime;
            video.currentTime = pos + 0.1; // Force seek to reset decoder
            // Wait for seek to complete? usually handled by player events, but we'll return success
            return { level: 3, success: true, remainingDesync: 0 };
        } catch (e) {
            Logger.add('[AV_SYNC] Level 3 failed', { error: e.message });
            return { level: 3, success: false, remainingDesync: discrepancy };
        }
    };

    const level4_reload = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 4: Full reload via video.load()');
        try {
            const pos = video.currentTime;
            const src = video.src;

            // Basic reload sequence
            video.src = '';
            video.load();
            video.src = src;
            video.currentTime = pos;
            await video.play();

            return { level: 4, success: true, remainingDesync: 0 };
        } catch (e) {
            Logger.add('[AV_SYNC] Level 4 failed', { error: e.message });
            return { level: 4, success: false, remainingDesync: discrepancy };
        }
    };

    return {
        execute: async (video, discrepancy) => {
            const startTime = performance.now();
            const severity = classifySeverity(discrepancy);

            Logger.add('[AV_SYNC] Recovery initiated', {
                discrepancy: discrepancy.toFixed(2) + 'ms',
                severity,
                currentTime: video.currentTime,
                criticalThreshold: CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS + 'ms'
            });

            if (severity === RecoveryConstants.SEVERITY.MINOR) {
                Logger.add('[AV_SYNC] Level 1: Ignoring minor desync', {
                    reason: 'Below moderate threshold (1000ms)'
                });
                return;
            }

            let result;

            // DISABLED: This 500ms pause delay was causing constant desync instead of fixing it
            // The artificial delay disrupts browser-native A/V sync mechanisms
            // Keeping code for potential reversion if needed
            // if (severity === RecoveryConstants.SEVERITY.MODERATE) {
            //     Metrics.increment('av_sync_level2_attempts');
            //     result = await level2_pauseResume(video, discrepancy);
            // }

            if (severity === RecoveryConstants.SEVERITY.MODERATE) {
                // MONITORING ONLY - trust browser-native sync
                Logger.add('[AV_SYNC] MONITORING ONLY - moderate desync detected', {
                    severity,
                    discrepancy: discrepancy.toFixed(2) + 'ms',
                    reason: 'Disabled level2_pauseResume to prevent introducing delays',
                    wouldHaveTriggered: 'level2_pauseResume (500ms pause)',
                    action: 'Trusting browser-native A/V sync mechanisms'
                });
                Metrics.increment('av_sync_level2_skipped');
                return;
            }

            // DISABLED: Seeking disrupts playback unnecessarily for moderate desyncs
            // Browser handles A/V sync better than manual intervention
            // else if (severity === RecoveryConstants.SEVERITY.SEVERE) {
            //     Metrics.increment('av_sync_level3_attempts');
            //     result = await level3_seek(video, discrepancy);
            // }

            else if (severity === RecoveryConstants.SEVERITY.SEVERE && discrepancy < CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS) {
                // MONITORING ONLY - trust browser-native sync for severe but not critical
                Logger.add('[AV_SYNC] MONITORING ONLY - severe desync detected', {
                    severity,
                    discrepancy: discrepancy.toFixed(2) + 'ms',
                    reason: 'Disabled level3_seek to avoid disrupting playback',
                    wouldHaveTriggered: 'level3_seek (position +0.1s)',
                    action: 'Trusting browser-native A/V sync mechanisms',
                    note: 'Will only reload if exceeds critical threshold (' + CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS + 'ms)'
                });
                Metrics.increment('av_sync_level3_skipped');
                return;
            }

            else if (severity === RecoveryConstants.SEVERITY.CRITICAL || discrepancy >= CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS) {
                // ONLY reload for CRITICAL desync - indicates broken stream
                Logger.add('[AV_SYNC] CRITICAL desync - performing stream reload', {
                    severity,
                    discrepancy: discrepancy.toFixed(2) + 'ms',
                    criticalThreshold: CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS + 'ms',
                    reason: 'Desync severe enough to indicate stream failure'
                });
                Metrics.increment('av_sync_level4_attempts');
                result = await level4_reload(video, discrepancy);

                const duration = performance.now() - startTime;
                Logger.add('[AV_SYNC] Recovery complete', {
                    level: result.level,
                    success: result.success,
                    duration: duration.toFixed(2) + 'ms',
                    remainingDesync: result.remainingDesync
                });

                if (!result.success) {
                    Logger.add('[AV_SYNC] Recovery failed, may escalate on next check');
                }
            }
        }
    };
})();

// --- Buffer Analyzer ---
/**
 * Analyzes video buffer state to determine recovery strategy.
 * @responsibility Calculate buffer health and determine if aggressive recovery is needed.
 */
const BufferAnalyzer = (() => {
    return {
        analyze: (video) => {
            if (!video || !video.buffered || video.buffered.length === 0) {
                return {
                    needsAggressive: false,
                    bufferEnd: 0,
                    bufferStart: 0,
                    currentTime: video ? video.currentTime : 0,
                    bufferSize: 0,
                    bufferHealth: 'unknown'
                };
            }

            const currentTime = video.currentTime;
            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const bufferStart = video.buffered.start(0);
            const bufferSize = bufferEnd - bufferStart;

            // Check if stuck at buffer end
            const atBufferEnd = Math.abs(currentTime - bufferEnd) < 0.5;
            const hasHealthyBuffer = bufferSize >= CONFIG.player.BUFFER_HEALTH_S;

            let bufferHealth = 'healthy';
            if (bufferSize < CONFIG.player.BUFFER_HEALTH_S) {
                bufferHealth = 'critical';
            } else if (bufferSize < CONFIG.player.BUFFER_HEALTH_S * 2) {
                bufferHealth = 'low';
            }

            return {
                needsAggressive: atBufferEnd && hasHealthyBuffer,
                bufferEnd,
                bufferStart,
                currentTime,
                bufferSize,
                bufferHealth
            };
        }
    };
})();

// --- Experimental Recovery ---
/**
 * Experimental recovery strategies for testing new approaches.
 * @responsibility Serve as a playground for testing experimental recovery methods.
 * Can be enabled/disabled at runtime. Sits between Standard and Aggressive in the cascade.
 */
const ExperimentalRecovery = (() => {
    let enabled = false;  // Runtime toggle

    // Registry of experimental strategies to try
    const strategies = {
        pausePlay: async (video) => {
            Logger.add('Experimental: Pause/Play cycle');
            video.pause();
            await Fn.sleep(100);
            await video.play();
        },

        rateFluctuation: async (video) => {
            Logger.add('Experimental: Playback rate fluctuation');
            const oldRate = video.playbackRate;
            video.playbackRate = 0.5;
            await Fn.sleep(200);
            video.playbackRate = oldRate;
        }

        // Add more experimental strategies here as needed
    };

    return {
        // Main execute - tries all strategies sequentially
        execute: async (video) => {
            Logger.add('Executing experimental recovery');
            Metrics.increment('experimental_recoveries');

            // Try each strategy
            for (const [name, strategy] of Object.entries(strategies)) {
                try {
                    Logger.add(`Trying experimental strategy: ${name}`);
                    await strategy(video);
                    await Fn.sleep(100); // Let state settle

                    // Check if it helped (readyState 3 = HAVE_FUTURE_DATA)
                    if (video.readyState >= 3) {
                        Logger.add(`Experimental strategy '${name}' succeeded`);
                        return;
                    }
                } catch (e) {
                    Logger.add(`Experimental strategy '${name}' error`, { error: e.message });
                }
            }

            Logger.add('All experimental strategies attempted');
        },

        setEnabled: (state) => {
            enabled = state;
            Logger.add(`Experimental recovery ${state ? 'ENABLED' : 'DISABLED'}`);
        },

        isEnabled: () => enabled,

        hasStrategies: () => Object.keys(strategies).length > 0,

        // Test individual strategy (for manual testing)
        testStrategy: async (video, strategyName) => {
            if (strategies[strategyName]) {
                Logger.add(`Testing experimental strategy: ${strategyName}`);
                await strategies[strategyName](video);
            } else {
                Logger.add(`Unknown strategy: ${strategyName}`, {
                    available: Object.keys(strategies)
                });
            }
        }
    };
})();

// --- Play Retry Handler ---
/**
 * Manages persistent play attempts with exponential backoff.
 * @responsibility
 * 1. Validate video state before playing.
 * 2. Execute play attempts with backoff.
 * 3. Apply micro-seeks if stuck.
 * 4. Handle errors and decide when to give up.
 */
const PlayRetryHandler = (() => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 150;

    return {
        /**
         * Attempts to force the video to play with retries.
         * @param {HTMLVideoElement} video - The video element
         * @param {string} context - Context for logging (e.g., 'post-recovery')
         * @returns {Promise<boolean>} True if successful
         */
        retry: async (video, context = 'general') => {
            // Wait for video to become ready with timeout
            const READY_WAIT_MS = 5000;
            const startWait = Date.now();
            while (!PlayValidator.validatePlayable(video)) {
                if (Date.now() - startWait > READY_WAIT_MS) {
                    Logger.add('[PlayRetry] Video not ready after wait', {
                        readyState: video.readyState,
                        error: video.error ? video.error.code : null,
                        waitedMs: Date.now() - startWait
                    });
                    return false;
                }
                await Fn.sleep(200);
            }

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    // 1. Micro-seek Strategy
                    if (MicroSeekStrategy.shouldApplyMicroSeek(video, attempt)) {
                        await MicroSeekStrategy.executeMicroSeek(video);
                    }

                    // 2. Play Execution
                    await PlayExecutor.attemptPlay(video);

                    // 3. Verification
                    const isPlaying = await PlayValidator.waitForPlaying(video);
                    if (isPlaying) {
                        Logger.add(`[PlayRetry] Success (${context})`, { attempt });
                        return true;
                    } else {
                        throw new Error('Playback verification failed');
                    }

                } catch (error) {
                    const errorInfo = PlayExecutor.categorizePlayError(error);

                    // Special handling for AbortError (often temporary race condition)
                    if (errorInfo.name === 'AbortError') {
                        Logger.add(`[PlayRetry] AbortError detected, retrying immediately...`, { attempt });
                        await Fn.sleep(50); // Tiny backoff
                        attempt--; // Don't count this as a full attempt
                        if (attempt < 0) attempt = 0; // Safety
                        continue;
                    }

                    Logger.add(`[PlayRetry] Attempt ${attempt} failed`, {
                        error: errorInfo.name,
                        message: errorInfo.message,
                        fatal: errorInfo.isFatal
                    });

                    if (errorInfo.isFatal) return false;

                    if (attempt < MAX_RETRIES) {
                        await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                    }
                }
            }

            Logger.add(`[PlayRetry] Failed after ${MAX_RETRIES} attempts`);
            return false;
        }
    };
})();

// --- Recovery Diagnostics ---
/**
 * Diagnoses playback blockers before attempting recovery.
 * @responsibility
 * 1. Identify WHY the player is stuck.
 * 2. Suggest targeted recovery strategies.
 * 3. Prevent wasted recovery attempts on unrecoverable states.
 */
const RecoveryDiagnostics = (() => {

    /**
     * Diagnoses the current video state to determine recovery feasibility.
     * @param {HTMLVideoElement} video
     * @returns {{canRecover: boolean, blockers: string[], suggestedStrategy: string, details: Object}}
     */
    const diagnose = (video) => {
        if (!video) {
            return {
                canRecover: false,
                blockers: ['NO_VIDEO_ELEMENT'],
                suggestedStrategy: 'fatal',
                details: { error: 'Video element is null or undefined' }
            };
        }

        // 1. DOM Attachment Check
        if (!video.isConnected) {
            Logger.add('[DIAGNOSTICS] Video element detached from DOM');
            return {
                canRecover: false,
                blockers: ['VIDEO_DETACHED'],
                suggestedStrategy: 'fatal',
                details: { error: 'Video element not connected to DOM' }
            };
        }

        // 2. Media Error Check
        if (video.error) {
            const errorCode = video.error.code;
            const isFatal = errorCode === video.error.MEDIA_ERR_SRC_NOT_SUPPORTED;

            Logger.add('[DIAGNOSTICS] Media error detected', {
                code: errorCode,
                message: video.error.message
            });

            return {
                canRecover: !isFatal,
                blockers: [`MEDIA_ERROR_${errorCode}`],
                suggestedStrategy: isFatal ? 'fatal' : 'aggressive',
                details: {
                    errorCode,
                    errorMessage: video.error.message,
                    isFatal
                }
            };
        }

        // 3. Network State Check
        if (video.networkState === video.NETWORK_NO_SOURCE) {
            Logger.add('[DIAGNOSTICS] No source available');
            return {
                canRecover: false,
                blockers: ['NO_SOURCE'],
                suggestedStrategy: 'fatal',
                details: { networkState: video.networkState }
            };
        }

        // 4. Seeking State Check
        if (video.seeking) {
            Logger.add('[DIAGNOSTICS] Video currently seeking');
            return {
                canRecover: true,
                blockers: ['ALREADY_SEEKING'],
                suggestedStrategy: 'wait',
                details: {
                    suggestion: 'Wait for seek to complete',
                    currentTime: video.currentTime
                }
            };
        }

        // 5. Ready State Check
        if (video.readyState < 3) {
            Logger.add('[DIAGNOSTICS] Insufficient data', {
                readyState: video.readyState
            });

            return {
                canRecover: true,
                blockers: ['INSUFFICIENT_DATA'],
                suggestedStrategy: 'wait',
                details: {
                    readyState: video.readyState,
                    suggestion: 'Wait for buffering to complete before recovery'
                }
            };
        }

        // 6. Buffer Health Check
        const bufferAnalysis = BufferAnalyzer.analyze(video);
        // Only report critical buffer if we have actual buffered content
        if (bufferAnalysis.bufferHealth === 'critical' && video.buffered.length > 0) {
            Logger.add('[DIAGNOSTICS] Critical buffer detected', bufferAnalysis);
            return {
                canRecover: true,
                blockers: ['CRITICAL_BUFFER'],
                suggestedStrategy: 'aggressive',
                details: {
                    bufferSize: bufferAnalysis.bufferSize,
                    bufferHealth: bufferAnalysis.bufferHealth,
                    suggestion: 'Standard recovery (seeking) will fail - need stream refresh'
                }
            };
        }

        // 7. Check signature stability (if available)
        if (Logic && Logic.Player && Logic.Player.isSessionUnstable) {
            const isUnstable = Logic.Player.isSessionUnstable();
            if (isUnstable) {
                Logger.add('[DIAGNOSTICS] Warning: Player signatures unstable');
            }
        }

        // All checks passed - standard recovery can proceed
        Logger.add('[DIAGNOSTICS] Video state appears recoverable', {
            readyState: video.readyState,
            paused: video.paused,
            bufferHealth: bufferAnalysis.bufferHealth
        });

        return {
            canRecover: true,
            blockers: [],
            suggestedStrategy: 'standard',
            details: {
                readyState: video.readyState,
                paused: video.paused,
                currentTime: video.currentTime,
                bufferHealth: bufferAnalysis.bufferHealth,
                bufferSize: bufferAnalysis.bufferSize
            }
        };
    };

    return {
        diagnose
    };
})();

// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * REFACTORED: Aggressive/Experimental escalation DISABLED.
 * - These strategies were causing player destruction
 * - Now always uses StandardRecovery with comprehensive logging
 */
const RecoveryStrategy = (() => {
    /**
     * Validates video element
     */
    const validateVideo = (video) => {
        if (!video || !(video instanceof HTMLVideoElement)) {
            Logger.add('[STRATEGY:VALIDATE] Invalid video element', {
                type: typeof video,
                isElement: video instanceof HTMLElement
            });
            return false;
        }
        return true;
    };

    return {
        select: (video, options = {}) => {
            // Log what was requested
            Logger.add('[STRATEGY:SELECT] Strategy selection requested', {
                forceExperimental: !!options.forceExperimental,
                forceAggressive: !!options.forceAggressive,
                forceStandard: !!options.forceStandard
            });

            // DISABLED: Aggressive/Experimental - these destroy the player
            if (options.forceExperimental) {
                Logger.add('[STRATEGY:BLOCKED] ExperimentalRecovery requested but DISABLED', {
                    reason: 'Experimental recovery causes player destruction',
                    action: 'Using StandardRecovery instead'
                });
                // return ExperimentalRecovery; // DISABLED
                return StandardRecovery;
            }

            if (options.forceAggressive) {
                Logger.add('[STRATEGY:BLOCKED] AggressiveRecovery requested but DISABLED', {
                    reason: 'Aggressive recovery causes player destruction',
                    action: 'Using StandardRecovery instead'
                });
                // return AggressiveRecovery; // DISABLED
                return StandardRecovery;
            }

            if (!validateVideo(video)) {
                Logger.add('[STRATEGY:FALLBACK] Invalid video, using StandardRecovery');
                return StandardRecovery;
            }

            // Buffer analysis for logging purposes
            let analysis;
            try {
                analysis = BufferAnalyzer.analyze(video);
            } catch (error) {
                Logger.add('[STRATEGY:ERROR] BufferAnalyzer failed', {
                    error: String(error),
                    action: 'Using StandardRecovery'
                });
                return StandardRecovery;
            }

            Logger.add('[STRATEGY:SELECTED] StandardRecovery', {
                bufferHealth: analysis?.bufferHealth,
                bufferSize: analysis?.bufferSize?.toFixed(2),
                wouldHaveEscalated: analysis?.needsAggressive,
                reason: 'Aggressive strategies disabled'
            });

            return StandardRecovery;
        },

        /**
         * DISABLED: Escalation causes cascading failures
         * Now always returns null (no escalation)
         */
        getEscalation: (video, lastStrategy) => {
            // Log what would have happened
            let wouldEscalate = null;
            let reason = 'unknown';

            if (lastStrategy === StandardRecovery) {
                try {
                    const analysis = BufferAnalyzer.analyze(video);
                    if (analysis?.needsAggressive) {
                        wouldEscalate = 'AggressiveRecovery';
                        reason = 'Critical buffer state';
                    }
                } catch (e) {
                    reason = 'BufferAnalyzer error';
                }
            }

            Logger.add('[STRATEGY:ESCALATION] Escalation check (DISABLED)', {
                lastStrategy: lastStrategy?.name || 'unknown',
                wouldHaveEscalatedTo: wouldEscalate,
                reason: wouldEscalate ? reason : 'No escalation needed',
                action: 'BLOCKED - escalation causes player destruction',
                result: null
            });

            // DISABLED: Return null to prevent any escalation
            return null;
        }
    };
})();


// --- Recovery Utilities ---
/**
 * Shared utilities for recovery modules.
 * @responsibility Provide common state capture and logging helpers.
 */
const RecoveryUtils = (() => {
    /**
     * Captures current video state snapshot.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Object} State snapshot
     */
    const captureVideoState = (video) => ({
        readyState: video.readyState,
        networkState: video.networkState,
        currentTime: video.currentTime,
        paused: video.paused,
        error: video.error ? video.error.code : null,
        bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
    });

    /**
     * Logs state transitions between two snapshots.
     * @param {Object} lastState - Previous state snapshot
     * @param {Object} currentState - Current state snapshot
     * @param {number} elapsed - Elapsed time in ms
     */
    const logStateTransitions = (lastState, currentState, elapsed) => {
        if (!lastState) return;

        if (lastState.readyState !== currentState.readyState) {
            Logger.add('Recovery: readyState transition', {
                from: lastState.readyState,
                to: currentState.readyState,
                elapsed_ms: elapsed.toFixed(0)
            });
        }

        if (lastState.networkState !== currentState.networkState) {
            Logger.add('Recovery: networkState transition', {
                from: lastState.networkState,
                to: currentState.networkState,
                elapsed_ms: elapsed.toFixed(0)
            });
        }

        if (!lastState.error && currentState.error) {
            Logger.add('Recovery: ERROR appeared during wait', {
                errorCode: currentState.error,
                elapsed_ms: elapsed.toFixed(0)
            });
        }
    };

    /**
     * Waits for video to reach ready state with forensic logging.
     * @param {HTMLVideoElement} video - The video element
     * @param {Object} options - Configuration options
     * @param {number} options.startTime - Recovery start timestamp
     * @param {number} options.timeoutMs - Max wait time
     * @param {number} options.checkIntervalMs - Check interval
     * @returns {Promise<void>}
     */
    const waitForStability = (video, options) => {
        const { startTime, timeoutMs, checkIntervalMs } = options;

        return new Promise(resolve => {
            const maxChecks = timeoutMs / checkIntervalMs;
            let checkCount = 0;
            let lastState = null;
            let lastCurrentTime = video.currentTime;

            const interval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                const currentState = captureVideoState(video);

                // Log state transitions
                logStateTransitions(lastState, currentState, elapsed);

                // Log progress every 1 second (10 checks at 100ms intervals)
                if (checkCount % 10 === 0 && checkCount > 0) {
                    const timeAdvanced = Math.abs(currentState.currentTime - lastCurrentTime) > 0.1;
                    Logger.add(`Recovery progress [${elapsed.toFixed(0)}ms]`, {
                        ...currentState,
                        playheadMoving: timeAdvanced
                    });
                }

                lastState = { ...currentState };
                lastCurrentTime = currentState.currentTime;
                checkCount++;

                // Success condition
                if (video.readyState >= 2) {
                    clearInterval(interval);
                    Logger.add('Player stabilized successfully', {
                        duration_ms: elapsed.toFixed(0),
                        finalReadyState: video.readyState,
                        totalChecks: checkCount
                    });
                    resolve();
                } else if (checkCount >= maxChecks) {
                    clearInterval(interval);
                    Logger.add('Player stabilization timeout', {
                        duration_ms: elapsed.toFixed(0),
                        finalReadyState: video.readyState,
                        finalNetworkState: video.networkState,
                        totalChecks: checkCount,
                        lastError: video.error ? video.error.code : null
                    });
                    resolve();
                }
            }, checkIntervalMs);
        });
    };

    return {
        captureVideoState,
        logStateTransitions,
        waitForStability
    };
})();

// --- Resilience Orchestrator ---
/**
 * Orchestrates recovery execution.
 * REFACTORED: Simplified recovery with comprehensive logging.
 * - Removed page reload fallback (was destroying player)
 * - Added detailed state logging at every decision point
 * - Passive approach: log, try gentle recovery, let player self-heal
 */
const ResilienceOrchestrator = (() => {
    // Helper to capture complete video state for logging
    const captureVideoState = (video) => {
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };

        let bufferedRanges = [];
        try {
            for (let i = 0; i < video.buffered.length; i++) {
                bufferedRanges.push({
                    start: video.buffered.start(i).toFixed(2),
                    end: video.buffered.end(i).toFixed(2)
                });
            }
        } catch (e) {
            bufferedRanges = ['error reading buffer'];
        }

        return {
            currentTime: video.currentTime?.toFixed(3),
            duration: video.duration?.toFixed(3) || 'unknown',
            paused: video.paused,
            ended: video.ended,
            readyState: video.readyState,
            networkState: video.networkState,
            error: video.error ? { code: video.error.code, message: video.error.message } : null,
            buffered: bufferedRanges,
            playbackRate: video.playbackRate,
            muted: video.muted,
            volume: video.volume?.toFixed(2),
            srcType: video.src ? (video.src.startsWith('blob:') ? 'blob' : 'url') : 'none'
        };
    };

    return {
        /**
         * Main entry point for recovery.
         * @param {HTMLElement} container - The player container
         * @param {Object} payload - Event payload containing reason and flags
         * @returns {Promise<boolean>} True if recovery was successful
         */
        execute: async (container, payload = {}) => {
            const startTime = performance.now();
            const reason = payload.reason || 'unknown';
            const source = payload.source || 'UNKNOWN';

            // ========== ENTRY LOGGING ==========
            const video = Adapters.DOM.find('video');
            Logger.add('[RECOVERY:ENTER] Recovery triggered', {
                source,
                trigger: payload.trigger,
                reason,
                forceAggressive: !!payload.forceAggressive,
                forceExperimental: !!payload.forceExperimental,
                videoState: captureVideoState(video)
            });

            // 1. Concurrency Guard
            if (!RecoveryLock.acquire()) {
                Logger.add('[RECOVERY:BLOCKED] Already in progress', {
                    reason: 'concurrent_recovery',
                    source
                });
                return false;
            }

            try {
                if (!video) {
                    Logger.add('[RECOVERY:ABORT] No video element', { source });
                    return false;
                }

                // 2. Check if already healthy
                const alreadyHealthy = !payload.forceAggressive &&
                    !payload.forceExperimental &&
                    RecoveryValidator.detectAlreadyHealthy(video);

                if (alreadyHealthy) {
                    Logger.add('[RECOVERY:SKIP] Video already healthy', {
                        reason,
                        state: captureVideoState(video)
                    });
                    return true;
                }

                // 3. A/V Sync Routing
                if (AVSyncRouter.shouldRouteToAVSync(reason)) {
                    Logger.add('[RECOVERY:ROUTE] Routing to AVSync recovery', { reason });
                    const result = await AVSyncRouter.executeAVSyncRecovery();
                    Logger.add('[RECOVERY:ROUTE_RESULT] AVSync recovery completed', {
                        success: result,
                        finalState: captureVideoState(video)
                    });
                    return result;
                }

                // 4. Pre-recovery Snapshot
                const preSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);
                Logger.add('[RECOVERY:PRE_STATE] Before recovery', { preSnapshot });

                // 5. Buffer Analysis
                const bufferHealth = BufferAnalyzer.analyze(video);
                Logger.add('[RECOVERY:BUFFER] Buffer analysis', {
                    bufferHealth: bufferHealth?.bufferHealth,
                    bufferSize: bufferHealth?.bufferSize?.toFixed(2),
                    needsAggressive: bufferHealth?.needsAggressive
                });

                // 5.5 Strategy Selection (DISABLED aggressive escalation)
                // Previously: if critical buffer, force aggressive
                // NOW: Log but don't escalate - aggressive recovery destroys player
                if (bufferHealth && bufferHealth.bufferHealth === 'critical') {
                    Logger.add('[RECOVERY:DECISION] Critical buffer detected - would have escalated', {
                        action: 'SKIPPED_ESCALATION',
                        reason: 'Aggressive recovery disabled - causes player destruction'
                    });
                    // payload.forceAggressive = true; // DISABLED
                }

                const strategy = RecoveryStrategy.select(video, payload);
                Logger.add('[RECOVERY:STRATEGY] Strategy selected', {
                    name: strategy?.name || 'unknown',
                    wasForced: payload.forceAggressive || payload.forceExperimental
                });

                // 6. Execute Strategy
                await strategy.execute(video);

                // 7. Post-recovery Analysis
                const postSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);
                const delta = VideoSnapshotHelper.calculateRecoveryDelta(preSnapshot, postSnapshot);
                const validation = RecoveryValidator.validateRecoverySuccess(preSnapshot, postSnapshot, delta);

                Logger.add('[RECOVERY:POST_STATE] After recovery', {
                    valid: validation.isValid,
                    hasImprovement: validation.hasImprovement,
                    issues: validation.issues,
                    delta,
                    postSnapshot
                });

                // 8. Escalation Decision (DISABLED destructive escalation)
                if (!validation.isValid) {
                    Logger.add('[RECOVERY:ESCALATION] Recovery ineffective', {
                        action: 'GENTLE_BUFFER_SEEK',
                        reason: 'Aggressive escalation disabled'
                    });

                    // Only try gentle buffer seek - no aggressive recovery
                    if (video.buffered.length > 0) {
                        try {
                            const end = video.buffered.end(video.buffered.length - 1);
                            const target = Math.max(video.currentTime, end - 2);
                            video.currentTime = target;
                            Logger.add('[RECOVERY:SEEK] Jumped to buffer end', {
                                from: preSnapshot.currentTime?.toFixed(2),
                                to: target.toFixed(2),
                                bufferEnd: end.toFixed(2)
                            });
                        } catch (e) {
                            Logger.add('[RECOVERY:SEEK_FAILED] Buffer seek failed', { error: e.message });
                        }
                    }
                }

                // 9. Play Retry Decision
                const shouldRetryPlay = video.paused || validation.hasImprovement;
                Logger.add('[RECOVERY:PLAY_DECISION] Play retry evaluation', {
                    shouldRetry: shouldRetryPlay,
                    videoPaused: video.paused,
                    hasImprovement: validation.hasImprovement,
                    readyState: video.readyState
                });

                let playSuccess = false;
                if (shouldRetryPlay) {
                    playSuccess = await PlayRetryHandler.retry(video, 'post-recovery');
                    Logger.add('[RECOVERY:PLAY_RESULT] Play retry completed', {
                        success: playSuccess,
                        finalPaused: video.paused,
                        finalReadyState: video.readyState
                    });
                }

                // 10. Final State (REMOVED page reload - was destroying player)
                const duration = (performance.now() - startTime).toFixed(0);
                const finalState = captureVideoState(video);

                if (!playSuccess && !validation.isValid && video.paused) {
                    // Previously: window.location.reload()
                    // NOW: Just log and let player potentially self-recover
                    Logger.add('[RECOVERY:INCOMPLETE] Recovery did not fully succeed', {
                        duration: duration + 'ms',
                        action: 'LETTING_PLAYER_SELF_HEAL',
                        reason: 'Page reload disabled - was destroying player',
                        suggestion: 'User may need to manually refresh if stream stuck',
                        finalState
                    });
                } else {
                    Logger.add('[RECOVERY:EXIT] Recovery completed', {
                        duration: duration + 'ms',
                        success: validation.isValid,
                        playSuccess,
                        finalState
                    });
                }

                return validation.isValid;

            } catch (error) {
                Logger.add('[RECOVERY:ERROR] Critical error during recovery', {
                    message: error.message,
                    stack: error.stack?.split('\n').slice(0, 5),
                    videoState: captureVideoState(video)
                });
                return false;
            } finally {
                RecoveryLock.release();
                Logger.add('[RECOVERY:LOCK] Lock released');
            }
        }
    };
})();


// --- Standard Recovery ---
/**
 * Simple recovery strategy - GENTLER than before.
 * REFACTORED: Try play() first, only seek as fallback.
 * - Previous approach (seek + play) was too aggressive
 * - Now: try play → if stuck, gentle seek → try play again
 */
const StandardRecovery = (() => {
    const name = 'StandardRecovery';

    // Helper to capture state for logging
    const getState = (video) => ({
        currentTime: video.currentTime?.toFixed(3),
        paused: video.paused,
        readyState: video.readyState,
        networkState: video.networkState,
        buffered: video.buffered?.length > 0
            ? `[${video.buffered.start(0).toFixed(2)}, ${video.buffered.end(video.buffered.length - 1).toFixed(2)}]`
            : 'empty'
    });

    return {
        name,

        execute: async (video) => {
            const startTime = performance.now();

            Logger.add('[STANDARD:ENTER] Starting gentle recovery', {
                state: getState(video)
            });

            if (!video) {
                Logger.add('[STANDARD:ABORT] No video element');
                return;
            }

            // STEP 1: If video is paused, just try to play
            if (video.paused) {
                Logger.add('[STANDARD:STEP1] Video paused, attempting play()');
                try {
                    await video.play();
                    await Fn.sleep(200); // Brief wait to check if it worked

                    if (!video.paused) {
                        Logger.add('[STANDARD:SUCCESS] Play succeeded on first attempt', {
                            duration: (performance.now() - startTime).toFixed(0) + 'ms',
                            state: getState(video)
                        });
                        return; // Success! No need to seek
                    }
                    Logger.add('[STANDARD:STEP1_FAIL] Play returned but video still paused');
                } catch (e) {
                    Logger.add('[STANDARD:STEP1_ERROR] Play failed', {
                        error: e.name,
                        message: e.message
                    });
                }
            } else {
                Logger.add('[STANDARD:STEP1_SKIP] Video already playing', {
                    readyState: video.readyState
                });
                // Check if it's actually progressing
                const timeBefore = video.currentTime;
                await Fn.sleep(500);
                const timeAfter = video.currentTime;

                if (Math.abs(timeAfter - timeBefore) > 0.1) {
                    Logger.add('[STANDARD:SUCCESS] Video is playing and progressing', {
                        progress: (timeAfter - timeBefore).toFixed(3) + 's',
                        state: getState(video)
                    });
                    return; // Actually playing fine
                }
                Logger.add('[STANDARD:STUCK] Video not paused but not progressing', {
                    timeBefore: timeBefore.toFixed(3),
                    timeAfter: timeAfter.toFixed(3)
                });
            }

            // STEP 2: If play didn't work, try gentle seek (only if we have buffer)
            if (!video.buffered || video.buffered.length === 0) {
                Logger.add('[STANDARD:ABORT] No buffer available for seek');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const seekTarget = Math.max(0, bufferEnd - 2); // Just 2 seconds back (was 3.5)

            Logger.add('[STANDARD:STEP2] Attempting gentle seek', {
                from: video.currentTime.toFixed(3),
                to: seekTarget.toFixed(3),
                bufferEnd: bufferEnd.toFixed(3)
            });

            try {
                video.currentTime = seekTarget;
                await Fn.sleep(200);
            } catch (e) {
                Logger.add('[STANDARD:SEEK_ERROR] Seek failed', { error: e.message });
            }

            // STEP 3: Try play again after seek
            if (video.paused) {
                Logger.add('[STANDARD:STEP3] Post-seek play attempt');
                try {
                    await video.play();
                } catch (e) {
                    Logger.add('[STANDARD:STEP3_ERROR] Post-seek play failed', {
                        error: e.name,
                        message: e.message
                    });
                    // Don't throw - let ResilienceOrchestrator handle it
                }
            }

            // Log final state
            const duration = (performance.now() - startTime).toFixed(0);
            Logger.add('[STANDARD:EXIT] Recovery attempt complete', {
                duration: duration + 'ms',
                success: !video.paused && video.readyState >= 3,
                state: getState(video)
            });

            // Delayed health check
            setTimeout(() => {
                Logger.add('[STANDARD:DELAYED_CHECK] Post-recovery health', {
                    state: getState(video),
                    isPlaying: !video.paused && video.readyState >= 3
                });
            }, 1500);
        }
    };
})();



// ============================================================================
// 6. CORE ORCHESTRATOR
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * @responsibility Initialize all modules in the correct order.
 */
const CoreOrchestrator = (() => {
    return {
        init: () => {
            Logger.add('Core initialized');

            // Don't run in iframes
            if (window.self !== window.top) return;

            // Check throttling
            const { lastAttempt, errorCount } = Store.get();
            if (errorCount >= CONFIG.timing.LOG_THROTTLE &&
                Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS) {
                if (CONFIG.debug) {
                    console.warn('[MAD-3000] Core throttled.');
                }
                return;
            }

            // Initialize modules in order
            NetworkManager.init();
            Instrumentation.init();
            EventCoordinator.init();
            ScriptBlocker.init();
            AdBlocker.init();

            // Plan B: Initialize live pattern updates
            if (CONFIG.experimental?.ENABLE_LIVE_PATTERNS &&
                typeof PatternUpdater !== 'undefined') {
                PatternUpdater.init();
                Logger.add('[Core] PatternUpdater initialized');
            }

            // Wait for DOM if needed
            if (document.body) {
                DOMObserver.init();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    DOMObserver.init();
                }, { once: true });
            }

            // Expose debug triggers
            window.forceTwitchAdRecovery = () => {
                Logger.add('Manual recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, { source: 'MANUAL_TRIGGER' });
            };

            window.forceTwitchAggressiveRecovery = () => {
                Logger.add('Manual AGGRESSIVE recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'MANUAL_TRIGGER',
                    forceAggressive: true
                });
            };

            // Experimental recovery controls
            window.toggleExperimentalRecovery = (enable) => {
                ExperimentalRecovery.setEnabled(enable);
            };

            window.testExperimentalStrategy = (strategyName) => {
                const video = document.querySelector('video');
                if (video) {
                    ExperimentalRecovery.testStrategy(video, strategyName);
                } else {
                    console.log('No video element found');
                }
            };

            window.forceTwitchExperimentalRecovery = () => {
                Logger.add('Manual EXPERIMENTAL recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'MANUAL_TRIGGER',
                    forceExperimental: true
                });
            };

            window.testTwitchAdPatterns = () => {
                if (typeof PatternTester !== 'undefined') {
                    return PatternTester.test();
                } else {
                    console.error('PatternTester module not loaded');
                    return { error: 'Module not loaded' };
                }
            };

            // Plan B: PatternUpdater controls
            window.updateTwitchAdPatterns = () => {
                if (typeof PatternUpdater !== 'undefined') {
                    Logger.add('Manual pattern update triggered');
                    return PatternUpdater.forceUpdate();
                }
                return { error: 'PatternUpdater not loaded' };
            };

            window.getTwitchPatternStats = () => {
                if (typeof PatternUpdater !== 'undefined') {
                    return PatternUpdater.getStats();
                }
                return { error: 'PatternUpdater not loaded' };
            };

            window.addTwitchPatternSource = (url) => {
                if (typeof PatternUpdater !== 'undefined') {
                    PatternUpdater.addSource(url);
                    return PatternUpdater.forceUpdate();
                }
                return { error: 'PatternUpdater not loaded' };
            };

            // Plan B: PlayerPatcher controls (experimental)
            window.enableTwitchPlayerPatcher = () => {
                if (typeof PlayerPatcher !== 'undefined') {
                    PlayerPatcher.enable();
                    Logger.add('[Core] PlayerPatcher enabled via console');
                    return PlayerPatcher.getStats();
                }
                return { error: 'PlayerPatcher not loaded' };
            };

            window.disableTwitchPlayerPatcher = () => {
                if (typeof PlayerPatcher !== 'undefined') {
                    PlayerPatcher.disable();
                    return { disabled: true };
                }
                return { error: 'PlayerPatcher not loaded' };
            };

            window.getTwitchPlayerPatcherStats = () => {
                if (typeof PlayerPatcher !== 'undefined') {
                    return PlayerPatcher.getStats();
                }
                return { error: 'PlayerPatcher not loaded' };
            };

            // Expose AdCorrelation stats
            window.getTwitchAdCorrelationStats = () => {
                if (typeof AdCorrelation !== 'undefined') {
                    return AdCorrelation.exportData();
                }
                return { error: 'AdCorrelation not loaded' };
            };
        }
    };
})();

CoreOrchestrator.init();


})();
