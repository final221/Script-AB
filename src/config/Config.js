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
            STUCK_THRESHOLD_S: 0.1,
            STUCK_COUNT_LIMIT: 2,
            STANDARD_SEEK_BACK_S: 3.5,
            BLOB_SEEK_BACK_S: 3,
            BUFFER_HEALTH_S: 5,
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
