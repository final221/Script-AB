// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================
/**
 * Central configuration object for Stream Healer.
 * Streamlined: Only contains settings relevant to stream healing.
 * @typedef {Object} Config
 * @property {boolean} debug - Toggles console logging.
 * @property {Object} selectors - DOM selectors for player elements.
 * @property {Object} stall - Stall detection and healing settings.
 * @property {Object} logging - Logging behavior settings.
 */
const CONFIG = (() => {
    const raw = {
        debug: true,

        selectors: {
            PLAYER: '.video-player',
            VIDEO: 'video',
        },

        // StreamHealer stall detection configuration
        stall: {
            WATCHDOG_INTERVAL_MS: 1000,     // Watchdog interval for stall checks
            STALL_CONFIRM_MS: 2500,         // Required no-progress window before healing
            STALL_CONFIRM_BUFFER_OK_MS: 1500, // Extra delay when buffer is healthy
            PAUSED_STALL_GRACE_MS: 3000,    // Allow stall detection shortly after pause
            INIT_PROGRESS_GRACE_MS: 5000,   // Wait for initial progress before treating as stalled
            RECOVERY_WINDOW_MS: 1500,       // Recent progress window to consider recovered
            RETRY_COOLDOWN_MS: 2000,        // Cooldown between heal attempts for same stall
            HEAL_POLL_INTERVAL_MS: 200,     // How often to poll for heal point
            HEAL_TIMEOUT_S: 15,             // Give up after this many seconds
            NO_HEAL_POINT_BACKOFF_BASE_MS: 5000, // Base backoff after no heal point
            NO_HEAL_POINT_BACKOFF_MAX_MS: 60000, // Max backoff after repeated no heal points
            FAILOVER_AFTER_NO_HEAL_POINTS: 3, // Failover after this many consecutive no-heal points
            FAILOVER_AFTER_STALL_MS: 30000,  // Failover after this long stuck without progress
            FAILOVER_PROGRESS_TIMEOUT_MS: 8000, // Trial time for failover candidate to progress
            FAILOVER_COOLDOWN_MS: 30000,     // Minimum time between failover attempts
        },

        monitoring: {
            MAX_VIDEO_MONITORS: 8,          // Max concurrent video elements to monitor
            CANDIDATE_SWITCH_DELTA: 2,      // Min score delta before switching active video
            CANDIDATE_MIN_PROGRESS_MS: 5000, // Require sustained progress before switching to new video
            PROGRESS_STREAK_RESET_MS: 2500, // Reset progress streak after this long without progress
            PROBE_COOLDOWN_MS: 5000,        // Min time between probe attempts per candidate
        },

        logging: {
            LOG_CSP_WARNINGS: true,
            NON_ACTIVE_LOG_MS: 300000,
        },
    };

    return Object.freeze(raw);
})();
