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
            BUFFER_STARVE_THRESHOLD_S: 0.75, // Buffer headroom below this is considered starving
            BUFFER_STARVE_CONFIRM_MS: 2000, // Time buffer must stay low before starve mode
            BUFFER_STARVE_BACKOFF_MS: 3000, // Delay heal attempts while starving
            BUFFER_STARVE_RESCAN_COOLDOWN_MS: 15000, // Min time between starvation rescans
            PAUSED_STALL_GRACE_MS: 3000,    // Allow stall detection shortly after pause
            INIT_PROGRESS_GRACE_MS: 5000,   // Wait for initial progress before treating as stalled
            RESET_GRACE_MS: 2000,           // Delay before confirming reset (abort/emptied)
            RECOVERY_WINDOW_MS: 1500,       // Recent progress window to consider recovered
            SELF_RECOVER_GRACE_MS: 4000,    // Wait for recent src/buffer changes before healing
            SELF_RECOVER_MAX_MS: 12000,     // Max time to defer healing for self-recovery signals
            SELF_RECOVER_EXTRA_MS: 3000,    // Extra grace when buffer grows/readyState improves
            RETRY_COOLDOWN_MS: 2000,        // Cooldown between heal attempts for same stall
            HEAL_POLL_INTERVAL_MS: 200,     // How often to poll for heal point
            HEAL_TIMEOUT_S: 15,             // Give up after this many seconds
            NO_HEAL_POINT_BACKOFF_BASE_MS: 5000, // Base backoff after no heal point
            NO_HEAL_POINT_BACKOFF_MAX_MS: 60000, // Max backoff after repeated no heal points
            PLAY_ERROR_BACKOFF_BASE_MS: 2000, // Base backoff after play failures (Abort/PLAY_STUCK)
            PLAY_ERROR_BACKOFF_MAX_MS: 20000, // Max backoff after repeated play failures
            PLAY_ABORT_BACKOFF_BASE_MS: 8000, // Base backoff after AbortError failures
            PLAY_ABORT_BACKOFF_MAX_MS: 30000, // Max backoff after repeated AbortError failures
            PLAY_ERROR_DECAY_MS: 15000,    // Reset play-error count after this idle window
            FAILOVER_AFTER_NO_HEAL_POINTS: 3, // Failover after this many consecutive no-heal points
            FAILOVER_AFTER_PLAY_ERRORS: 3, // Failover after this many consecutive play failures
            FAILOVER_AFTER_STALL_MS: 30000,  // Failover after this long stuck without progress
            FAST_SWITCH_AFTER_NO_HEAL_POINTS: 2, // Switch when active healing is stuck and a stable candidate exists
            FAST_SWITCH_AFTER_STALL_MS: 15000, // Switch when healing stalls too long and another candidate is stable
            HEALPOINT_REPEAT_FAILOVER_COUNT: 3, // Failover after repeated identical heal points
            FAILOVER_PROGRESS_TIMEOUT_MS: 8000, // Trial time for failover candidate to progress
            FAILOVER_COOLDOWN_MS: 30000,     // Minimum time between failover attempts
            PROBATION_AFTER_NO_HEAL_POINTS: 2, // Open probation after this many no-heal points
            PROBATION_AFTER_PLAY_ERRORS: 2, // Open probation after this many play failures
            PROBATION_RESCAN_COOLDOWN_MS: 15000, // Min time between probation rescans
            REFRESH_AFTER_NO_HEAL_POINTS: 3, // Force refresh after repeated no-heal cycles
            REFRESH_COOLDOWN_MS: 120000,     // Minimum time between forced refreshes
            NO_HEAL_POINT_REFRESH_DELAY_MS: 15000, // Delay refresh when headroom is low but src/readyState look valid
            NO_HEAL_POINT_REFRESH_MIN_READY_STATE: 2, // ReadyState threshold to allow refresh delay
            NO_HEAL_POINT_EMERGENCY_AFTER: 2, // Emergency switch after this many no-heal points
            NO_HEAL_POINT_EMERGENCY_COOLDOWN_MS: 15000, // Cooldown between emergency switches
            NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE: 2, // Min readyState for emergency switch candidates
            NO_HEAL_POINT_EMERGENCY_REQUIRE_SRC: true, // Require src for emergency switch candidates
            NO_HEAL_POINT_EMERGENCY_ALLOW_DEAD: false, // Allow emergency switches to dead candidates
            NO_HEAL_POINT_EMERGENCY_SWITCH: true, // Enable emergency candidate switching
            NO_HEAL_POINT_LAST_RESORT_SWITCH: true, // Attempt last-resort candidate switch before refresh
            NO_HEAL_POINT_LAST_RESORT_AFTER: 1, // Trigger last-resort after this many no-heal points
            NO_HEAL_POINT_LAST_RESORT_REQUIRE_STARVED: true, // Require buffer starvation before last-resort switch
            NO_HEAL_POINT_LAST_RESORT_MIN_READY_STATE: 0, // Allow last-resort candidates with any readyState
            NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC: false, // Allow last-resort candidates without src
            NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD: true, // Allow last-resort switches to dead candidates
            PROCESSING_ASSET_LAST_RESORT_SWITCH: true, // Attempt last-resort switch on processing asset hint
        },

        monitoring: {
            MAX_VIDEO_MONITORS: 8,          // Max concurrent video elements to monitor
            CANDIDATE_SWITCH_DELTA: 2,      // Min score delta before switching active video
            CANDIDATE_MIN_PROGRESS_MS: 5000, // Require sustained progress before switching to new video
            PROBATION_WINDOW_MS: 10000,     // Window to allow untrusted candidate switching
            PROBATION_READY_STATE: 2,       // Minimum readyState to allow probation override
            PROBATION_MIN_PROGRESS_MS: 500, // Require brief progress before probation takeover
            PROGRESS_STREAK_RESET_MS: 2500, // Reset progress streak after this long without progress
            PROGRESS_RECENT_MS: 2000,       // "Recent progress" threshold for scoring
            PROGRESS_STALE_MS: 5000,        // "Stale progress" threshold for scoring
            TRUST_STALE_MS: 8000,           // Trust expires if progress is older than this
            PROBE_COOLDOWN_MS: 5000,        // Min time between probe attempts per candidate
            DEAD_CANDIDATE_AFTER_MS: 5000,  // Mark candidate dead after sustained empty src + readyState 0
            DEAD_CANDIDATE_COOLDOWN_MS: 20000, // Exclude dead candidates for this long
            SYNC_SAMPLE_MS: 5000,           // Sample window for drift detection
            SYNC_DRIFT_MAX_MS: 1000,        // Log if drift exceeds this threshold
            SYNC_RATE_MIN: 0.9,             // Log if playback rate falls below this ratio
        },

        recovery: {
            MIN_HEAL_BUFFER_S: 2,           // Minimum buffered seconds needed to heal
            MIN_HEAL_BUFFER_EMERGENCY_S: 0.5, // Minimum buffer for emergency/rewind heal
            MIN_HEAL_HEADROOM_S: 0.75,      // Minimum headroom required to attempt a heal
            HEAL_NUDGE_S: 0.5,              // How far to nudge into buffer for contiguous ranges
            HEAL_EDGE_GUARD_S: 0.35,        // Avoid seeking too close to buffer end
            GAP_OVERRIDE_MIN_GAP_S: 0.25,   // Minimum gap size to allow low-headroom gap heal
            GAP_OVERRIDE_MIN_HEADROOM_S: 0.35, // Min headroom when overriding for ad gaps
            HEAL_RETRY_DELAY_MS: 200,       // Delay before retrying heal after AbortError
            SEEK_SETTLE_MS: 100,            // Wait after seek before validation
            PLAYBACK_VERIFY_MS: 200,        // Wait after play to verify playback
            CATCH_UP_MIN_S: 2,              // Minimum lag behind live edge before catching up
            CATCH_UP_DELAY_MS: 3000,        // Delay after a heal before attempting catch-up
            CATCH_UP_STABLE_MS: 5000,       // Require this long without stalls before catch-up
            CATCH_UP_RETRY_MS: 5000,        // Delay before retrying deferred catch-up
            CATCH_UP_MAX_ATTEMPTS: 3,       // Max catch-up attempts per heal
        },

        logging: {
            LOG_CSP_WARNINGS: true,
            NON_ACTIVE_LOG_MS: 300000,      // Non-active candidate log interval
            ACTIVE_LOG_MS: 5000,            // Active candidate log interval
            ACTIVE_EVENT_LOG_MS: 2000,      // Active video event log throttle
            ACTIVE_EVENT_SUMMARY_MS: 180000, // Active video event summary interval
            SUPPRESSION_LOG_MS: 300000,     // Suppressed switch log interval
            SYNC_LOG_MS: 300000,            // Playback drift log interval
            BACKOFF_LOG_INTERVAL_MS: 5000,  // Backoff skip log interval
            HEAL_DEFER_LOG_MS: 5000,        // Heal deferral log interval
            STARVE_LOG_MS: 10000,           // Buffer starvation log interval
            RESOURCE_WINDOW_PAST_MS: 30000, // Resource log window before stall
            RESOURCE_WINDOW_FUTURE_MS: 60000, // Resource log window after stall
            RESOURCE_WINDOW_MAX: 8000,      // Max resource entries to keep in memory
            CONSOLE_SIGNAL_THROTTLE_MS: 2000, // Throttle console hint signals
            RESOURCE_HINT_THROTTLE_MS: 2000,  // Throttle resource hint signals
            LOG_MESSAGE_MAX_LEN: 300,       // Max length for log messages
            LOG_REASON_MAX_LEN: 200,        // Max length for error reasons
            LOG_URL_MAX_LEN: 200,           // Max length for logged URLs
            CONSOLE_CAPTURE_MAX_LEN: 500,   // Max length for captured console lines
            REPORT_DETAIL_COLUMN: 40,       // Column for first detail separator in report
            REPORT_MESSAGE_COLUMN: 50,      // Column for message/detail split in report
            MAX_LOGS: 5000,                 // Max in-memory script logs
            MAX_CONSOLE_LOGS: 2000,         // Max in-memory console logs
        },
    };

    return Object.freeze(raw);
})();

