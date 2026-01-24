// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       4.1.48
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
            MAX_LOGS: 5000,                 // Max in-memory script logs
            MAX_CONSOLE_LOGS: 2000,         // Max in-memory console logs
        },
    };

    return Object.freeze(raw);
})();


// --- BuildInfo ---
/**
 * Build metadata helpers (version injected at build time).
 */
const BuildInfo = (() => {
    const VERSION = '4.1.48';

    const getVersion = () => {
        const gmVersion = (typeof GM_info !== 'undefined' && GM_info?.script?.version)
            ? GM_info.script.version
            : null;
        if (gmVersion) return gmVersion;
        const unsafeVersion = (typeof unsafeWindow !== 'undefined' && unsafeWindow?.GM_info?.script?.version)
            ? unsafeWindow.GM_info.script.version
            : null;
        if (unsafeVersion) return unsafeVersion;
        if (VERSION && VERSION !== '4.1.48') return VERSION;
        return null;
    };

    const getVersionLine = () => {
        const version = getVersion();
        return version ? `Version: ${version}\n` : '';
    };

    return {
        VERSION,
        getVersion,
        getVersionLine
    };
})();

// --- Tuning ---
/**
 * Derived thresholds and helper accessors for tuning logic.
 */
const Tuning = (() => {
    const stallConfirmMs = (bufferExhausted) => {
        const base = CONFIG.stall.STALL_CONFIRM_MS;
        if (bufferExhausted) return base;
        return base + CONFIG.stall.STALL_CONFIRM_BUFFER_OK_MS;
    };

    const logIntervalMs = (isActive) => (
        isActive ? CONFIG.logging.ACTIVE_LOG_MS : CONFIG.logging.NON_ACTIVE_LOG_MS
    );

    return {
        stallConfirmMs,
        logIntervalMs
    };
})();

// --- ConfigValidator ---
/**
 * Lightweight config validation and sanity checks.
 */
const ConfigValidator = (() => {
    const validate = (config) => {
        const warnings = [];
        const warn = (message, detail = {}) => warnings.push({ message, detail });

        if (!config?.stall) return warnings;

        if (config.stall.STALL_CONFIRM_MS <= 0) {
            warn('STALL_CONFIRM_MS must be positive', { value: config.stall.STALL_CONFIRM_MS });
        }
        if (config.stall.SELF_RECOVER_MAX_MS
            && config.stall.SELF_RECOVER_GRACE_MS > config.stall.SELF_RECOVER_MAX_MS) {
            warn('SELF_RECOVER_GRACE_MS exceeds SELF_RECOVER_MAX_MS', {
                graceMs: config.stall.SELF_RECOVER_GRACE_MS,
                maxMs: config.stall.SELF_RECOVER_MAX_MS
            });
        }
        if (config.stall.NO_HEAL_POINT_BACKOFF_BASE_MS > config.stall.NO_HEAL_POINT_BACKOFF_MAX_MS) {
            warn('NO_HEAL_POINT_BACKOFF_BASE_MS exceeds NO_HEAL_POINT_BACKOFF_MAX_MS', {
                baseMs: config.stall.NO_HEAL_POINT_BACKOFF_BASE_MS,
                maxMs: config.stall.NO_HEAL_POINT_BACKOFF_MAX_MS
            });
        }
        if (config.stall.PLAY_ERROR_BACKOFF_BASE_MS > config.stall.PLAY_ERROR_BACKOFF_MAX_MS) {
            warn('PLAY_ERROR_BACKOFF_BASE_MS exceeds PLAY_ERROR_BACKOFF_MAX_MS', {
                baseMs: config.stall.PLAY_ERROR_BACKOFF_BASE_MS,
                maxMs: config.stall.PLAY_ERROR_BACKOFF_MAX_MS
            });
        }
        if ((config.stall.PLAY_ABORT_BACKOFF_BASE_MS || 0) > (config.stall.PLAY_ABORT_BACKOFF_MAX_MS || 0)) {
            warn('PLAY_ABORT_BACKOFF_BASE_MS exceeds PLAY_ABORT_BACKOFF_MAX_MS', {
                baseMs: config.stall.PLAY_ABORT_BACKOFF_BASE_MS,
                maxMs: config.stall.PLAY_ABORT_BACKOFF_MAX_MS
            });
        }
        if (config.stall.HEAL_TIMEOUT_S * 1000 < config.stall.STALL_CONFIRM_MS) {
            warn('HEAL_TIMEOUT_S is shorter than STALL_CONFIRM_MS', {
                healTimeoutMs: config.stall.HEAL_TIMEOUT_S * 1000,
                stallConfirmMs: config.stall.STALL_CONFIRM_MS
            });
        }

        return warnings;
    };

    return { validate };
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
 * Side-effect wrappers for DOM and Event handling.
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
    }
};

// --- BufferRanges ---
/**
 * Helpers for working with media buffer ranges.
 */
const BufferRanges = (() => {
    const getBufferRanges = (video) => {
        const ranges = [];
        const buffered = video?.buffered;
        if (!buffered) return ranges;

        const length = buffered.length;
        for (let i = 0; i < length; i++) {
            if (i >= buffered.length) break;
            try {
                ranges.push({
                    start: buffered.start(i),
                    end: buffered.end(i)
                });
            } catch (error) {
                Logger.add(LogEvents.tagged('BUFFER_ERROR', 'Buffer ranges changed during read'), {
                    error: error?.name,
                    message: error?.message,
                    index: i,
                    length: buffered.length
                });
                break;
            }
        }
        return ranges;
    };

    const formatRanges = (ranges) => {
        if (!ranges || ranges.length === 0) return 'none';
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    const getBufferAhead = (video) => {
        const ranges = getBufferRanges(video);
        if (!ranges.length) {
            return {
                bufferAhead: null,
                rangeStart: null,
                rangeEnd: null,
                hasBuffer: false
            };
        }

        const currentTime = video.currentTime;
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            if (currentTime >= range.start && currentTime <= range.end) {
                return {
                    bufferAhead: range.end - currentTime,
                    rangeStart: range.start,
                    rangeEnd: range.end,
                    hasBuffer: true
                };
            }
        }

        return {
            bufferAhead: null,
            rangeStart: null,
            rangeEnd: null,
            hasBuffer: true
        };
    };

    const isBufferExhausted = (video) => {
        const buffered = video?.buffered;
        if (!buffered || buffered.length === 0) {
            return true;
        }

        const currentTime = video.currentTime;

        const length = buffered.length;
        for (let i = 0; i < length; i++) {
            if (i >= buffered.length) break;
            let start;
            let end;
            try {
                start = buffered.start(i);
                end = buffered.end(i);
            } catch (error) {
                Logger.add(LogEvents.tagged('BUFFER_ERROR', 'Buffer exhaustion check failed'), {
                    error: error?.name,
                    message: error?.message,
                    index: i,
                    length: buffered.length
                });
                return true;
            }

            if (currentTime >= start && currentTime <= end) {
                const bufferRemaining = end - currentTime;
                return bufferRemaining < 0.5;
            }
        }

        return true;
    };

    return {
        getBufferRanges,
        formatRanges,
        getBufferAhead,
        isBufferExhausted
    };
})();

// --- HealPointFinder ---
/**
 * Finds heal points in buffered ranges.
 */
const HealPointFinder = (() => {
    const MIN_HEAL_BUFFER_S = CONFIG.recovery.MIN_HEAL_BUFFER_S;
    const MIN_HEAL_BUFFER_EMERGENCY_S = CONFIG.recovery.MIN_HEAL_BUFFER_EMERGENCY_S;
    const NUDGE_S = CONFIG.recovery.HEAL_NUDGE_S;
    const EDGE_GUARD_S = CONFIG.recovery.HEAL_EDGE_GUARD_S;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const getEmergencyStart = (range, currentTime) => {
        const rangeSize = range.end - range.start;
        if (rangeSize <= 0) {
            return range.start;
        }
        if (rangeSize <= EDGE_GUARD_S * 2) {
            return range.start + (rangeSize * 0.5);
        }
        const desired = Math.min(currentTime + NUDGE_S, range.end - EDGE_GUARD_S);
        return clamp(desired, range.start + EDGE_GUARD_S, range.end - EDGE_GUARD_S);
    };

    const findHealPoint = (video, options = {}) => {
        if (!video) {
            if (!options.silent) {
                Logger.add(LogEvents.tagged('ERROR', 'No video element'));
            }
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = BufferRanges.getBufferRanges(video);

        if (!options.silent) {
            Logger.add(LogEvents.tagged('SCAN', 'Scanning for heal point'), {
                currentTime: currentTime.toFixed(3),
                bufferRanges: BufferRanges.formatRanges(ranges),
                rangeCount: ranges.length
            });
        }

        const candidates = [];
        const emergencyCandidates = [];

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const rangeSize = range.end - range.start;
            const effectiveStart = Math.max(range.start, currentTime);
            const contentAhead = range.end - effectiveStart;

            if (contentAhead <= MIN_HEAL_BUFFER_S) {
                if (rangeSize >= MIN_HEAL_BUFFER_EMERGENCY_S) {
                    const start = getEmergencyStart(range, currentTime);
                    emergencyCandidates.push({
                        start,
                        end: range.end,
                        gapSize: start - currentTime,
                        headroom: range.end - start,
                        inRange: currentTime >= range.start && currentTime <= range.end,
                        rangeIndex: i
                    });
                }
                continue;
            }

            let healStart = range.start + EDGE_GUARD_S;
            let isNudge = false;

            if (range.start <= currentTime && currentTime <= range.end) {
                healStart = currentTime + NUDGE_S;
                isNudge = true;
            }

            if (healStart >= range.end - EDGE_GUARD_S) {
                if (!options.silent) {
                    Logger.add(LogEvents.tagged('SKIP', 'Heal target too close to buffer end'), {
                        healStart: healStart.toFixed(3),
                        rangeEnd: range.end.toFixed(3),
                        edgeGuard: EDGE_GUARD_S
                    });
                }
                continue;
            }

            const headroom = range.end - healStart;
            const gapSize = healStart - currentTime;
            candidates.push({
                start: healStart,
                end: range.end,
                gapSize,
                headroom,
                isNudge,
                rangeIndex: i
            });
        }

        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                if (a.isNudge !== b.isNudge) return a.isNudge ? -1 : 1;
                if (a.gapSize !== b.gapSize) return a.gapSize - b.gapSize;
                return b.headroom - a.headroom;
            });

            const healPoint = candidates[0];

            if (!options.silent) {
                Logger.add(healPoint.isNudge
                    ? LogEvents.tagged('NUDGE', 'Contiguous buffer found')
                    : LogEvents.tagged('FOUND', 'Heal point identified'), {
                    healPoint: `${healPoint.start.toFixed(3)}-${healPoint.end.toFixed(3)}`,
                    gapSize: healPoint.gapSize.toFixed(2) + 's',
                    headroom: healPoint.headroom.toFixed(2) + 's',
                    edgeGuard: EDGE_GUARD_S
                });
            }

            return healPoint;
        }

        if (emergencyCandidates.length > 0) {
            emergencyCandidates.sort((a, b) => {
                if (a.inRange !== b.inRange) return a.inRange ? -1 : 1;
                const gapAbsA = Math.abs(a.gapSize);
                const gapAbsB = Math.abs(b.gapSize);
                if (gapAbsA !== gapAbsB) return gapAbsA - gapAbsB;
                return b.headroom - a.headroom;
            });

            const healPoint = emergencyCandidates[0];
            if (!options.silent) {
                Logger.add(LogEvents.tagged('EMERGENCY', 'Emergency heal point selected'), {
                    healPoint: `${healPoint.start.toFixed(3)}-${healPoint.end.toFixed(3)}`,
                    gapSize: healPoint.gapSize.toFixed(2) + 's',
                    headroom: healPoint.headroom.toFixed(2) + 's',
                    inRange: healPoint.inRange,
                    minRequired: MIN_HEAL_BUFFER_EMERGENCY_S + 's',
                    edgeGuard: EDGE_GUARD_S
                });
            }

            return healPoint;
        }

        if (!options.silent) {
            Logger.add(LogEvents.tagged('NONE', 'No valid heal point found'), {
                currentTime: currentTime.toFixed(3),
                ranges: BufferRanges.formatRanges(ranges),
                minRequired: MIN_HEAL_BUFFER_S + 's'
            });
        }

        return null;
    };

    return {
        findHealPoint,
        MIN_HEAL_BUFFER_S
    };
})();

// --- BufferGapFinder ---
/**
 * Finds "heal points" in the video buffer after a stall.
 * When uBO blocks ad segments, new content arrives in a separate buffer range.
 * This module finds that new range so we can seek to it.
 */
const BufferGapFinder = (() => {
    return {
        findHealPoint: HealPointFinder.findHealPoint,
        isBufferExhausted: BufferRanges.isBufferExhausted,
        getBufferRanges: BufferRanges.getBufferRanges,
        getBufferAhead: BufferRanges.getBufferAhead,
        formatRanges: BufferRanges.formatRanges,
        MIN_HEAL_BUFFER_S: HealPointFinder.MIN_HEAL_BUFFER_S
    };
})();

// --- SeekTargetCalculator ---
/**
 * Calculates and validates safe seek targets.
 */
const SeekTargetCalculator = (() => {
    const validateSeekTarget = (video, target) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return { valid: false, reason: 'No buffer' };
        }

        const buffered = video.buffered;
        const length = buffered.length;
        for (let i = 0; i < length; i++) {
            if (i >= buffered.length) break;
            let start;
            let end;
            try {
                start = buffered.start(i);
                end = buffered.end(i);
            } catch (error) {
                return { valid: false, reason: 'Buffer read failed' };
            }

            if (target >= start && target <= end) {
                return {
                    valid: true,
                    bufferRange: { start, end },
                    headroom: end - target
                };
            }
        }

        return { valid: false, reason: 'Target not in buffer' };
    };

    const calculateSafeTarget = (healPoint) => {
        const { start, end } = healPoint;
        const bufferSize = end - start;
        const edgeGuard = CONFIG.recovery.HEAL_EDGE_GUARD_S;

        if (bufferSize < 1) {
            const target = start + (bufferSize * 0.5);
            return Math.min(target, Math.max(start, end - edgeGuard));
        }

        const offset = Math.min(0.5, bufferSize - 1);
        const target = start + offset;
        return Math.min(target, Math.max(start, end - edgeGuard));
    };

    return {
        validateSeekTarget,
        calculateSafeTarget
    };
})();

// --- LiveEdgeSeeker ---
/**
 * Seeks to a heal point and resumes playback.
 * CRITICAL: Validates seek target is within buffer bounds to avoid Infinity duration.
 */
const LiveEdgeSeeker = (() => {
    /**
     * Seek to heal point and attempt to resume playback
     * 
     * @param {HTMLVideoElement} video
     * @param {{ start: number, end: number }} healPoint
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    const seekAndPlay = async (video, healPoint) => {
        const startTime = performance.now();
        const fromTime = video.currentTime;

        // Calculate safe target
        const target = SeekTargetCalculator.calculateSafeTarget(healPoint);

        const validation = SeekTargetCalculator.validateSeekTarget(video, target);
        const bufferRanges = BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video));

        Logger.add(LogEvents.tagged('SEEK', 'Attempting seek'), {
            from: fromTime.toFixed(3),
            to: target.toFixed(3),
            healRange: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
            valid: validation.valid,
            headroom: validation.headroom?.toFixed(2),
            bufferRanges
        });

        if (!validation.valid) {
            Logger.add(LogEvents.tagged('SEEK_ABORT', 'Invalid seek target'), {
                target: target.toFixed(3),
                reason: validation.reason,
                bufferRanges
            });
            return { success: false, error: validation.reason, errorName: 'INVALID_TARGET' };
        }

        // Perform seek
        try {
            video.currentTime = target;

            // Brief wait for seek to settle
            await Fn.sleep(CONFIG.recovery.SEEK_SETTLE_MS);

            Logger.add(LogEvents.tagged('SEEKED', 'Seek completed'), {
                newTime: video.currentTime.toFixed(3),
                readyState: video.readyState
            });
        } catch (e) {
            Logger.add(LogEvents.tagged('SEEK_ERROR', 'Seek failed'), {
                error: e.name,
                message: e.message,
                bufferRanges
            });
            return { success: false, error: e.message, errorName: e.name };
        }

        // Attempt playback
        if (video.paused) {
            Logger.add(LogEvents.tagged('PLAY', 'Attempting play'));
            try {
                await video.play();

                // Verify playback started
                await Fn.sleep(CONFIG.recovery.PLAYBACK_VERIFY_MS);

                if (!video.paused && video.readyState >= 3) {
                    const duration = (performance.now() - startTime).toFixed(0);
                    Logger.add(LogEvents.tagged('SUCCESS', 'Playback resumed'), {
                        duration: duration + 'ms',
                        currentTime: video.currentTime.toFixed(3),
                        readyState: video.readyState
                    });
                    return { success: true };
                } else {
                    Logger.add(LogEvents.tagged('PLAY_STUCK', 'Play returned but not playing'), {
                        paused: video.paused,
                        readyState: video.readyState,
                        networkState: video.networkState,
                        currentSrc: video.currentSrc || '',
                        bufferRanges
                    });
                    return { success: false, error: 'Play did not resume', errorName: 'PLAY_STUCK' };
                }
            } catch (e) {
                Logger.add(LogEvents.tagged('PLAY_ERROR', 'Play failed'), {
                    error: e.name,
                    message: e.message,
                    networkState: video.networkState,
                    readyState: video.readyState,
                    currentSrc: video.currentSrc || '',
                    bufferRanges
                });
                return { success: false, error: e.message, errorName: e.name };
            }
        } else {
            // Video already playing
            Logger.add(LogEvents.tagged('ALREADY_PLAYING', 'Video resumed on its own'));
            return { success: true };
        }
    };

    return {
        seekAndPlay,
        validateSeekTarget: SeekTargetCalculator.validateSeekTarget,
        calculateSafeTarget: SeekTargetCalculator.calculateSafeTarget
    };
})();

// --- Error Classifier ---
/**
 * Classifies errors based on type, message, and known patterns.
 * @responsibility Determine severity and required action for a given error.
 */
const ErrorClassifier = (() => {
    const BENIGN_PATTERNS = [
        'graphql',
        'unauthenticated',
        'pinnedchatsettings',
        'go.apollo.dev/c/err',
        'apollo.dev/c/err'
    ];

    return {
        classify: (error, message) => {
            // Critical media errors (track for recovery)
            if (error instanceof MediaError || (error && error.code >= 1 && error.code <= 4)) {
                return { severity: 'CRITICAL', action: 'LOG_AND_METRIC' };
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


// --- Logger ---
/**
 * Logging and telemetry collection with console capture for timeline correlation.
 * @exports add, captureConsole, getMergedTimeline, getLogs, getConsoleLogs
 */
const Logger = (() => {
    const logs = [];
    const consoleLogs = [];

    /**
     * Add an internal log entry.
     * @param {string} message - Log message (use prefixes like [HEALER:*], [CORE:*])
     * @param {Object|null} detail - Optional structured data
     */
    const add = (message, detail = null) => {
        if (logs.length >= CONFIG.logging.MAX_LOGS) logs.shift();
        logs.push({
            timestamp: new Date().toISOString(),
            type: 'internal',
            message,
            detail,
        });
    };

    /**
     * Capture console output for timeline correlation.
     * Called by Instrumentation module.
     * @param {'log'|'info'|'debug'|'warn'|'error'} level
     * @param {any[]} args - Console arguments
     */
    const captureConsole = (level, args) => {
        if (consoleLogs.length >= CONFIG.logging.MAX_CONSOLE_LOGS) consoleLogs.shift();

        let message;
        try {
            message = args.map(arg => {
                if (typeof arg === 'string') return arg;
                if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                try { return JSON.stringify(arg); } catch { return String(arg); }
            }).join(' ');

            if (message.length > CONFIG.logging.CONSOLE_CAPTURE_MAX_LEN) {
                message = message.substring(0, CONFIG.logging.CONSOLE_CAPTURE_MAX_LEN) + '... [truncated]';
            }
        } catch {
            message = '[Unable to stringify console args]';
        }

        consoleLogs.push({
            timestamp: new Date().toISOString(),
            type: 'console',
            level,
            message,
        });
    };

    /**
     * Get merged timeline of script logs + console logs, sorted chronologically.
     * @returns {Array<{timestamp, type, source, message, level?, detail?}>}
     */
    const getMergedTimeline = () => {
        const allLogs = [
            ...logs.map(l => ({ ...l, source: 'SCRIPT' })),
            ...consoleLogs.map(l => ({ ...l, source: 'CONSOLE' }))
        ];
        allLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return allLogs;
    };

    return {
        add,
        captureConsole,
        getLogs: () => logs,
        getConsoleLogs: () => consoleLogs,
        getMergedTimeline,
    };
})();



// --- LogEvents ---
/**
 * Central log tags and summary helpers for consistent, compact log messages.
 */
const LogEvents = (() => {
    const TAG = {
        STATE: '[HEALER:STATE]',
        WATCHDOG: '[HEALER:WATCHDOG]',
        STALL: '[HEALER:STALL]',
        READY: '[HEALER:READY]',
        PROGRESS: '[HEALER:PROGRESS]',
        BACKOFF: '[HEALER:BACKOFF]',
        PLAY_BACKOFF: '[HEALER:PLAY_BACKOFF]',
        STARVE: '[HEALER:STARVE]',
        STARVE_CLEAR: '[HEALER:STARVE_CLEAR]',
        STARVE_SKIP: '[HEALER:STARVE_SKIP]',
        SYNC: '[HEALER:SYNC]',
        RESET_CHECK: '[HEALER:RESET_CHECK]',
        RESET_SKIP: '[HEALER:RESET_SKIP]',
        RESET_PENDING: '[HEALER:RESET_PENDING]',
        RESET: '[HEALER:RESET]',
        RESET_CLEAR: '[HEALER:RESET_CLEAR]',
        DEBOUNCE: '[HEALER:DEBOUNCE]',
        STALL_SKIP: '[HEALER:STALL_SKIP]',
        EVENT: '[HEALER:EVENT]',
        EVENT_SUMMARY: '[HEALER:EVENT_SUMMARY]',
        ERROR: '[HEALER:ERROR]',
        SRC: '[HEALER:SRC]',
        MEDIA_STATE: '[HEALER:MEDIA_STATE]',
        MONITOR: '[HEALER:MONITOR]',
        VIDEO: '[HEALER:VIDEO]',
        SCAN: '[HEALER:SCAN]',
        SCAN_ITEM: '[HEALER:SCAN_ITEM]',
        BUFFER_ERROR: '[HEALER:BUFFER_ERROR]',
        REFRESH: '[HEALER:REFRESH]',
        STOP: '[HEALER:STOP]',
        SKIP: '[HEALER:SKIP]',
        NUDGE: '[HEALER:NUDGE]',
        FOUND: '[HEALER:FOUND]',
        EMERGENCY: '[HEALER:EMERGENCY]',
        NONE: '[HEALER:NONE]',
        CLEANUP: '[HEALER:CLEANUP]',
        ENDED: '[HEALER:ENDED]',
        CANDIDATE: '[HEALER:CANDIDATE]',
        CANDIDATE_DECISION: '[HEALER:CANDIDATE_DECISION]',
        CANDIDATE_SNAPSHOT: '[HEALER:CANDIDATE_SNAPSHOT]',
        PROBATION: '[HEALER:PROBATION]',
        SUPPRESSION: '[HEALER:SUPPRESSION_SUMMARY]',
        PROBE_BURST: '[HEALER:PROBE_BURST]',
        PROBE_SUMMARY: '[HEALER:PROBE_SUMMARY]',
        FAILOVER: '[HEALER:FAILOVER]',
        FAILOVER_SKIP: '[HEALER:FAILOVER_SKIP]',
        FAILOVER_PLAY: '[HEALER:FAILOVER_PLAY]',
        FAILOVER_SUCCESS: '[HEALER:FAILOVER_SUCCESS]',
        FAILOVER_REVERT: '[HEALER:FAILOVER_REVERT]',
        PRUNE: '[HEALER:PRUNE]',
        PRUNE_SKIP: '[HEALER:PRUNE_SKIP]',
        STALL_HINT: '[HEALER:STALL_HINT]',
        STALL_HINT_UNATTRIBUTED: '[HEALER:STALL_HINT_UNATTRIBUTED]',
        ASSET_HINT: '[HEALER:ASSET_HINT]',
        ASSET_HINT_SKIP: '[HEALER:ASSET_HINT_SKIP]',
        ASSET_HINT_PLAY: '[HEALER:ASSET_HINT_PLAY]',
        ADBLOCK_HINT: '[HEALER:ADBLOCK_HINT]',
        EXTERNAL: '[HEALER:EXTERNAL]',
        STALL_DETECTED: '[STALL:DETECTED]',
        STALL_DURATION: '[HEALER:STALL_DURATION]',
        HEAL_START: '[HEALER:START]',
        HEAL_FAILED: '[HEALER:FAILED]',
        HEAL_COMPLETE: '[HEALER:COMPLETE]',
        HEAL_DEFER: '[HEALER:DEFER]',
        HEAL_NO_POINT: '[HEALER:NO_HEAL_POINT]',
        HEALPOINT_STUCK: '[HEALER:HEALPOINT_STUCK]',
        CATCH_UP: '[HEALER:CATCH_UP]',
        BLOCKED: '[HEALER:BLOCKED]',
        DETACHED: '[HEALER:DETACHED]',
        SKIPPED: '[HEALER:SKIPPED]',
        SELF_RECOVER_SKIP: '[HEALER:SELF_RECOVER_SKIP]',
        STALE_RECOVERED: '[HEALER:STALE_RECOVERED]',
        STALE_GONE: '[HEALER:STALE_GONE]',
        POINT_UPDATED: '[HEALER:POINT_UPDATED]',
        RETRY: '[HEALER:RETRY]',
        RETRY_SKIP: '[HEALER:RETRY_SKIP]',
        ABORT_CONTEXT: '[HEALER:ABORT_CONTEXT]',
        SEEK: '[HEALER:SEEK]',
        SEEK_ABORT: '[HEALER:SEEK_ABORT]',
        SEEKED: '[HEALER:SEEKED]',
        SEEK_ERROR: '[HEALER:SEEK_ERROR]',
        PLAY: '[HEALER:PLAY]',
        PLAY_STUCK: '[HEALER:PLAY_STUCK]',
        PLAY_ERROR: '[HEALER:PLAY_ERROR]',
        ALREADY_PLAYING: '[HEALER:ALREADY_PLAYING]',
        SUCCESS: '[HEALER:SUCCESS]',
        GAP_OVERRIDE: '[HEALER:GAP_OVERRIDE]',
        POLL_START: '[HEALER:POLL_START]',
        POLL_SUCCESS: '[HEALER:POLL_SUCCESS]',
        POLL_TIMEOUT: '[HEALER:POLL_TIMEOUT]',
        POLLING: '[HEALER:POLLING]',
        SELF_RECOVERED: '[HEALER:SELF_RECOVERED]',
        AD_GAP: '[HEALER:AD_GAP_SIGNATURE]'
    };

    const roundNumber = (value, digits = 3) => {
        if (!Number.isFinite(value)) return value;
        if (Number.isInteger(value)) return value;
        return Number(value.toFixed(digits));
    };

    const formatValue = (value) => {
        if (value === undefined || value === null) return null;
        if (typeof value === 'number') return roundNumber(value);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string' && value.length === 0) return null;
        return value;
    };

    const formatVideoId = (value) => {
        if (typeof value !== 'string') return value;
        const match = value.match(/^video-(\d+)$/);
        if (!match) return value;
        return Number(match[1]);
    };

    const formatPairs = (pairs) => (
        pairs
            .map(([key, value]) => [key, formatValue(value)])
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => `${key}=${value}`)
            .join(' ')
    );

    const withTag = (tag, pairs) => {
        const body = formatPairs(pairs);
        return body ? `${tag} ${body}` : tag;
    };

    const getTag = (tagKey) => TAG[tagKey] || tagKey;

    const tagged = (tagKey, text) => {
        const label = getTag(tagKey);
        if (!text) return label;
        return `${label} ${text}`;
    };

    const pairs = (tagKey, pairsList) => withTag(getTag(tagKey), pairsList);

    const summary = {
        stateChange: (data = {}) => withTag(TAG.STATE, [
            ['video', formatVideoId(data.videoId)],
            ['from', data.from],
            ['to', data.to],
            ['reason', data.reason],
            ['currentTime', data.currentTime]
        ]),
        watchdogNoProgress: (data = {}) => withTag(TAG.WATCHDOG, [
            ['video', formatVideoId(data.videoId)],
            ['stalledForMs', data.stalledForMs],
            ['bufferExhausted', data.bufferExhausted],
            ['state', data.state],
            ['paused', data.paused],
            ['pauseFromStall', data.pauseFromStall]
        ]),
        stallDetected: (data = {}) => withTag(TAG.STALL_DETECTED, [
            ['video', formatVideoId(data.videoId)],
            ['trigger', data.trigger],
            ['stalledFor', data.stalledFor],
            ['bufferExhausted', data.bufferExhausted],
            ['paused', data.paused],
            ['pauseFromStall', data.pauseFromStall],
            ['lastProgressAgoMs', data.lastProgressAgoMs],
            ['currentTime', data.currentTime],
            ['readyState', data.readyState],
            ['networkState', data.networkState],
            ['buffered', data.buffered]
        ]),
        stallDuration: (data = {}) => withTag(TAG.STALL_DURATION, [
            ['video', formatVideoId(data.videoId)],
            ['reason', data.reason],
            ['durationMs', data.durationMs],
            ['currentTime', data.currentTime]
        ]),
        healStart: (data = {}) => withTag(TAG.HEAL_START, [
            ['attempt', data.attempt],
            ['lastProgressAgoMs', data.lastProgressAgoMs],
            ['currentTime', data.currentTime],
            ['paused', data.paused],
            ['readyState', data.readyState],
            ['networkState', data.networkState],
            ['buffered', data.buffered]
        ]),
        healFailed: (data = {}) => withTag(TAG.HEAL_FAILED, [
            ['duration', data.duration],
            ['errorName', data.errorName],
            ['error', data.error],
            ['healRange', data.healRange],
            ['gapSize', data.gapSize],
            ['isNudge', data.isNudge]
        ]),
        healComplete: (data = {}) => withTag(TAG.HEAL_COMPLETE, [
            ['duration', data.duration],
            ['healAttempts', data.healAttempts],
            ['bufferEndDelta', data.bufferEndDelta]
        ]),
        healDefer: (data = {}) => withTag(TAG.HEAL_DEFER, [
            ['bufferHeadroom', data.bufferHeadroom],
            ['minRequired', data.minRequired],
            ['healPoint', data.healPoint],
            ['buffers', data.buffers]
        ]),
        noHealPoint: (data = {}) => withTag(TAG.HEAL_NO_POINT, [
            ['duration', data.duration],
            ['currentTime', data.currentTime],
            ['bufferRanges', data.bufferRanges]
        ]),
        adGapSignature: (data = {}) => withTag(TAG.AD_GAP, [
            ['video', formatVideoId(data.videoId)],
            ['playheadSeconds', data.playheadSeconds],
            ['rangeEnd', data.rangeEnd],
            ['nextRangeStart', data.nextRangeStart],
            ['gapSize', data.gapSize],
            ['ranges', data.ranges]
        ])
    };

    return {
        TAG,
        summary,
        tagged,
        pairs,
        formatPairs,
        roundNumber
    };
})();

// --- ResourceWindow ---
/**
 * Tracks network resource activity for stall-adjacent windows.
 */
const ResourceWindow = (() => {
    const resourceEvents = [];
    const pendingWindows = new Map();

    const truncateUrl = (url) => (
        String(url).substring(0, CONFIG.logging.LOG_URL_MAX_LEN)
    );

    const record = (url, initiatorType) => {
        const now = Date.now();
        resourceEvents.push({
            ts: now,
            url: truncateUrl(url),
            initiatorType: initiatorType || null
        });

        const maxEntries = CONFIG.logging.RESOURCE_WINDOW_MAX || 8000;
        if (resourceEvents.length > maxEntries) {
            resourceEvents.splice(0, resourceEvents.length - maxEntries);
        }
    };

    const logWindow = (detail = {}) => {
        const stallTime = detail.stallTime || Date.now();
        const stallKey = Number.isFinite(detail.stallKey) ? detail.stallKey : stallTime;
        const videoId = detail.videoId || 'unknown';
        const key = `${videoId}:${stallKey}`;
        if (pendingWindows.has(key)) return;
        pendingWindows.set(key, true);

        const pastMs = CONFIG.logging.RESOURCE_WINDOW_PAST_MS || 30000;
        const futureMs = CONFIG.logging.RESOURCE_WINDOW_FUTURE_MS || 60000;

        Logger.add('[INSTRUMENT:RESOURCE_WINDOW_SCHEDULED]', {
            videoId,
            reason: detail.reason || 'stall',
            stalledFor: detail.stalledFor || null,
            windowPastMs: pastMs,
            windowFutureMs: futureMs
        });

        setTimeout(() => {
            const start = stallTime - pastMs;
            const end = stallTime + futureMs;
            const entries = resourceEvents
                .filter(item => item.ts >= start && item.ts <= end)
                .map(item => ({
                    offsetMs: item.ts - stallTime,
                    url: item.url,
                    initiatorType: item.initiatorType
                }));

            Logger.add('[INSTRUMENT:RESOURCE_WINDOW]', {
                videoId,
                reason: detail.reason || 'stall',
                stalledFor: detail.stalledFor || null,
                windowPastMs: pastMs,
                windowFutureMs: futureMs,
                total: entries.length,
                requests: entries
            });
            pendingWindows.delete(key);
        }, futureMs);
    };

    return {
        record,
        logWindow
    };
})();

// --- Metrics ---
/**
 * High-level telemetry and metrics tracking for Stream Healer.
 * Streamlined: Only tracks stream healing metrics.
 * @responsibility Collects and calculates application metrics.
 */
const Metrics = (() => {
    const STALL_HISTORY_MAX = 20;
    const counters = {
        stalls_detected: 0,
        stalls_duration_total_ms: 0,
        stalls_duration_max_ms: 0,
        stalls_duration_last_ms: 0,
        stalls_duration_count: 0,
        heals_successful: 0,
        heals_failed: 0,
        errors: 0,
        session_start: Date.now(),
    };
    const stallHistory = [];

    const increment = (category, value = 1) => {
        if (counters[category] !== undefined) {
            counters[category] += value;
        }
    };

    const getSummary = () => {
        const avgMs = counters.stalls_duration_count > 0
            ? Math.round(counters.stalls_duration_total_ms / counters.stalls_duration_count)
            : 0;

        return {
            ...counters,
            uptime_ms: Date.now() - counters.session_start,
            heal_rate: counters.stalls_detected > 0
                ? ((counters.heals_successful / counters.stalls_detected) * 100).toFixed(1) + '%'
                : 'N/A',
            stall_duration_avg_ms: avgMs,
            stall_duration_recent_ms: stallHistory.map(entry => entry.ms)
        };
    };

    const get = (category) => counters[category] || 0;

    const reset = () => {
        Object.keys(counters).forEach(key => {
            if (key !== 'session_start') counters[key] = 0;
        });
        counters.session_start = Date.now();
        stallHistory.length = 0;
    };

    return {
        increment,
        get,
        reset,
        getSummary,
        recordStallDuration: (durationMs, detail = {}) => {
            if (!Number.isFinite(durationMs) || durationMs <= 0) return;
            counters.stalls_duration_count += 1;
            counters.stalls_duration_total_ms += durationMs;
            counters.stalls_duration_last_ms = durationMs;
            counters.stalls_duration_max_ms = Math.max(counters.stalls_duration_max_ms, durationMs);

            stallHistory.push({
                ms: Math.round(durationMs),
                at: Date.now(),
                ...detail
            });
            if (stallHistory.length > STALL_HISTORY_MAX) {
                stallHistory.splice(0, stallHistory.length - STALL_HISTORY_MAX);
            }
        }
    };
})();

// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report.
 * Streamlined: Shows stream healing metrics instead of ad-blocking stats.
 */
const ReportGenerator = (() => {
    const getTimestampSuffix = () => new Date().toISOString().replace(/[:.]/g, '-');

    const generateContent = (metricsSummary, logs, healerStats) => {
        const healerLine = healerStats
            ? `Healer: isHealing ${healerStats.isHealing}, attempts ${healerStats.healAttempts}, monitors ${healerStats.monitoredCount}\n`
            : '';

        const stallCount = Number(metricsSummary.stalls_duration_count || 0);
        const stallAvgMs = Number(metricsSummary.stall_duration_avg_ms || 0);
        const stallMaxMs = Number(metricsSummary.stalls_duration_max_ms || 0);
        const stallLastMs = Number(metricsSummary.stalls_duration_last_ms || 0);
        const stallRecent = Array.isArray(metricsSummary.stall_duration_recent_ms)
            ? metricsSummary.stall_duration_recent_ms
            : [];
        const stallSummaryLine = stallCount > 0
            ? `Stall durations: count ${stallCount}, avg ${(stallAvgMs / 1000).toFixed(1)}s, max ${(stallMaxMs / 1000).toFixed(1)}s, last ${(stallLastMs / 1000).toFixed(1)}s\n`
            : 'Stall durations: none recorded\n';
        const stallRecentLine = stallRecent.length > 0
            ? `Recent stalls: ${stallRecent.slice(-5).map(ms => (Number(ms) / 1000).toFixed(1) + 's').join(', ')}\n`
            : '';

        // Header with metrics
        const versionLine = BuildInfo.getVersionLine();
        const DETAIL_COLUMN = 110;
        const formatTime = (timestamp) => {
            const parsed = new Date(timestamp);
            if (Number.isNaN(parsed.getTime())) return timestamp;
            return parsed.toISOString().slice(11, 23);
        };
        const formatLine = (prefix, message, detail, forceDetail = false) => {
            const base = `${prefix}${message}`;
            if (!forceDetail && (detail === null || detail === undefined || detail === '')) return base;
            const padLen = Math.max(1, DETAIL_COLUMN - base.length);
            const detailText = detail || '';
            return base + " ".repeat(padLen) + "| " + detailText;
        };

        const header = `[STREAM HEALER METRICS]
${versionLine}Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Stalls Detected: ${metricsSummary.stalls_detected}
Heals Successful: ${metricsSummary.heals_successful}
Heals Failed: ${metricsSummary.heals_failed}
Heal Rate: ${metricsSummary.heal_rate}
Errors: ${metricsSummary.errors}
${stallSummaryLine}${stallRecentLine}${healerLine}
[LEGEND]
\uD83E\uDE7A = Healer core (STATE/STALL/HEAL)
\uD83C\uDFAF = Candidate selection (CANDIDATE/PROBATION/SUPPRESSION)
\uD83E\uDDED = Monitor & video (VIDEO/MONITOR/SCAN/SRC/MEDIA_STATE/EVENT)
\uD83E\uDDEA = Instrumentation & signals (INSTRUMENT/RESOURCE/CONSOLE_HINT)
\uD83E\uDDF0 = Recovery & failover (FAILOVER/BACKOFF/RESET/CATCH_UP)
\uD83E\uDDFE = Metrics & config (SYNC/CONFIG)
\u2699\uFE0F = Core/system
\uD83D\uDCCB = Console.log/info/debug
\u26A0\uFE0F = Console.warn
\u274C = Console.error
[TIMELINE - Merged script + console logs]
`;

        // Format each log entry based on source and type
        const normalizeVideoToken = (value) => {
            if (typeof value !== 'string') return value;
            const match = value.match(/^video-(\d+)$/);
            if (!match) return value;
            return Number(match[1]);
        };

        const transformDetail = (input) => {
            if (Array.isArray(input)) {
                return input.map(transformDetail);
            }
            if (input && typeof input === 'object') {
                const result = {};
                Object.entries(input).forEach(([key, value]) => {
                    if (key === 'videoId') {
                        result.video = normalizeVideoToken(value);
                        return;
                    }
                    const transformed = transformDetail(value);
                    result[key] = normalizeVideoToken(transformed);
                });
                return result;
            }
            return normalizeVideoToken(input);
        };

        const stripKeys = (input, keys) => {
            if (Array.isArray(input)) {
                input.forEach(entry => stripKeys(entry, keys));
                return;
            }
            if (!input || typeof input !== 'object') return;
            Object.keys(input).forEach((key) => {
                if (keys.has(key)) {
                    delete input[key];
                } else {
                    stripKeys(input[key], keys);
                }
            });
        };

        const sanitizeDetail = (detail, message) => {
            if (!detail || typeof detail !== 'object') return detail;
            const sanitized = transformDetail(detail);
            const isVideoIntro = message.includes('[HEALER:VIDEO] Video registered');
            if (!isVideoIntro) {
                stripKeys(sanitized, new Set(['currentSrc', 'src']));
            }
            if (message.includes('[HEALER:MEDIA_STATE]') && message.includes('src attribute changed')) {
                delete sanitized.previous;
                delete sanitized.current;
                sanitized.changed = true;
            }
            if (message.includes('[HEALER:SRC]')) {
                delete sanitized.previous;
                delete sanitized.current;
                sanitized.changed = true;
            }
            return sanitized;
        };

        const ICONS = {
            healer: '\uD83E\uDE7A',
            candidate: '\uD83C\uDFAF',
            monitor: '\uD83E\uDDED',
            instrument: '\uD83E\uDDEA',
            recovery: '\uD83E\uDDF0',
            metrics: '\uD83E\uDDFE',
            core: '\u2699\uFE0F',
            other: '\uD83D\uDD27'
        };

        const categoryForTag = (tag) => {
            if (!tag) return 'other';
            const upper = tag.toUpperCase();
            if (upper.startsWith('INSTRUMENT')) return 'instrument';
            if (upper === 'CORE') return 'core';
            if (upper.startsWith('CANDIDATE')
                || upper.startsWith('PROBATION')
                || upper.startsWith('SUPPRESSION')
                || upper.startsWith('PROBE')) return 'candidate';
            if (['VIDEO', 'MONITOR', 'SCAN', 'SCAN_ITEM', 'SRC', 'MEDIA_STATE', 'EVENT', 'EVENT_SUMMARY'].includes(upper)) {
                return 'monitor';
            }
            if (upper.startsWith('FAILOVER')
                || upper.startsWith('BACKOFF')
                || upper.startsWith('RESET')
                || upper.startsWith('CATCH_UP')
                || upper.startsWith('REFRESH')
                || upper.startsWith('DETACHED')
                || upper.startsWith('BLOCKED')
                || upper.startsWith('PLAY_BACKOFF')
                || upper.startsWith('PRUNE')) {
                return 'recovery';
            }
            if (upper.startsWith('SYNC') || upper.startsWith('CONFIG') || upper.startsWith('METRIC')) return 'metrics';
            return 'healer';
        };

        const shouldStripKeyValueSummary = (rest, hasDetail) => (
            hasDetail && rest && /\b\w+=/.test(rest)
        );

        const formatScriptMessage = (message, hasDetail) => {
            const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (!match) {
                return {
                    icon: ICONS.other,
                    text: message
                };
            }
            const rawTag = match[1];
            const rest = match[2];
            let displayTag = rawTag;
            let tagKey = rawTag;
            if (rawTag.startsWith('HEALER:')) {
                displayTag = rawTag.slice(7);
                tagKey = displayTag;
            } else if (rawTag.startsWith('INSTRUMENT:')) {
                displayTag = `INSTRUMENT:${rawTag.slice(11)}`;
                tagKey = displayTag;
            }
            const category = categoryForTag(tagKey);
            const icon = ICONS[category] || ICONS.other;
            const trimmedRest = shouldStripKeyValueSummary(rest, hasDetail) ? '' : rest;
            const text = trimmedRest ? `[${displayTag}] ${trimmedRest}` : `[${displayTag}]`;
            return { icon, text };
        };


        const stripConsoleTimestamp = (message) => (
            message.replace(/^\s*\d{2}:\d{2}:\d{2}\s*-\s*/, '')
        );

        const splitConsoleMessage = (message) => {
            const match = message.match(/^\(([^)]+)\)\s*(.*)$/);
            if (match) {
                return {
                    summary: `(${match[1]})`,
                    detail: match[2] || ''
                };
            }
            return {
                summary: 'Console',
                detail: message
            };
        };

        const logContent = logs.map(l => {
            const time = formatTime(l.timestamp);

            if (l.source === 'CONSOLE' || l.type === 'console') {
                // Console log entry
                const icon = l.level === 'error' ? '\u274C' : l.level === 'warn' ? '\u26A0\uFE0F' : '\uD83D\uDCCB';
                const message = stripConsoleTimestamp(l.message);
                const split = splitConsoleMessage(message);
                const detail = JSON.stringify({ message: split.detail });
                return formatLine(`[${time}] ${icon} `, split.summary, detail, true);
            } else {
                // Internal script log
                const sanitized = sanitizeDetail(l.detail, l.message);
                const formatted = formatScriptMessage(l.message, Boolean(sanitized));
                const detail = sanitized && Object.keys(sanitized).length > 0
                    ? JSON.stringify(sanitized)
                    : '';
                return formatLine(`[${time}] ${formatted.icon} `, formatted.text, detail);
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

    const downloadFile = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `stream_healer_logs_${getTimestampSuffix()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return {
        exportReport: (metricsSummary, logs, healerStats) => {
            Logger.add("Generating and exporting report...");
            const content = generateContent(metricsSummary, logs, healerStats);
            downloadFile(content);
        }
    };
})();



// --- ConsoleInterceptor ---
/**
 * Captures console output and forwards to callbacks.
 */
const ConsoleInterceptor = (() => {
    const create = (options = {}) => {
        const onLog = options.onLog || (() => {});
        const onInfo = options.onInfo || (() => {});
        const onDebug = options.onDebug || (() => {});
        const onWarn = options.onWarn || (() => {});
        const onError = options.onError || (() => {});

        const intercept = (level, handler) => {
            const original = console[level];
            console[level] = (...args) => {
                original.apply(console, args);
                try {
                    handler(args);
                } catch (e) {
                    // Avoid recursion
                }
            };
        };

        const attach = () => {
            intercept('log', onLog);
            intercept('info', onInfo);
            intercept('debug', onDebug);
            intercept('warn', onWarn);
            intercept('error', onError);
        };

        return { attach };
    };

    return { create };
})();

// --- ConsoleSignalDetector ---
/**
 * Detects console messages that hint at playback issues.
 */
const ConsoleSignalDetector = (() => {
    const SIGNAL_PATTERNS = {
        PLAYHEAD_STALL: /playhead stalling at/i,
        PROCESSING_ASSET: /404_processing_640x360\.png/i,
        ADBLOCK_BLOCK: /(ERR_BLOCKED_BY_CLIENT|blocked by client|net::ERR_BLOCKED_BY_CLIENT|uBlock|uBO|ublock|adblock)/i,
    };

    const parsePlayheadStall = (message) => {
        const match = message.match(/playhead stalling at\s*([0-9.]+)\s*,\s*buffer end\s*([0-9.]+)/i);
        if (!match) return null;
        const playheadSeconds = Number.parseFloat(match[1]);
        const bufferEndSeconds = Number.parseFloat(match[2]);
        if (!Number.isFinite(playheadSeconds) || !Number.isFinite(bufferEndSeconds)) {
            return null;
        }
        return { playheadSeconds, bufferEndSeconds };
    };

    const parseBlockedUrl = (message) => {
        const match = message.match(/https?:\/\/[^\s"')]+/i);
        if (!match) return null;
        return match[0];
    };

    const create = (options = {}) => {
        const emitSignal = options.emitSignal || (() => {});
        const lastSignalTimes = {
            playhead_stall: 0,
            processing_asset: 0,
            adblock_block: 0
        };

        const maybeEmit = (type, message, level, detail = null) => {
            const now = Date.now();
            const lastTime = lastSignalTimes[type] || 0;
            if (now - lastTime < CONFIG.logging.CONSOLE_SIGNAL_THROTTLE_MS) {
                return;
            }
            lastSignalTimes[type] = now;
            Logger.add('[INSTRUMENT:CONSOLE_HINT] Console signal detected', {
                type,
                level,
                message: message.substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN),
                ...(detail || {})
            });
            emitSignal({
                type,
                level,
                message,
                timestamp: new Date().toISOString(),
                ...(detail || {})
            });
        };

        const detect = (level, message) => {
            if (SIGNAL_PATTERNS.PLAYHEAD_STALL.test(message)) {
                const detail = parsePlayheadStall(message);
                maybeEmit('playhead_stall', message, level, detail);
            }
            if (SIGNAL_PATTERNS.PROCESSING_ASSET.test(message)) {
                maybeEmit('processing_asset', message, level);
            }
            if (SIGNAL_PATTERNS.ADBLOCK_BLOCK.test(message)) {
                const url = parseBlockedUrl(message);
                maybeEmit('adblock_block', message, level, url ? { url } : null);
            }
        };

        return { detect };
    };

    return { create };
})();



// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior.
 * Streamlined: Captures console output for debugging timeline, no recovery triggering.
 * Recovery is now handled entirely by StreamHealer.monitor().
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;
    let externalSignalHandler = null;
    let signalDetector = null;
    const PROCESSING_ASSET_PATTERN = /404_processing_640x360\.png/i;
    let lastResourceHintTime = 0;
    const truncateMessage = (message, maxLen) => (
        String(message).substring(0, maxLen)
    );

    // Helper to capture video state for logging
    const getVideoState = () => {
        const video = document.querySelector('video');
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };
        let bufferedState = 'empty';
        try {
            if (video.buffered?.length > 0) {
                bufferedState = `${video.buffered.end(video.buffered.length - 1).toFixed(2)}`;
            }
        } catch (error) {
            bufferedState = 'unavailable';
        }
        return {
            currentTime: video.currentTime?.toFixed(2),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: bufferedState,
            error: video.error?.code
        };
    };

    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            const classification = classifyError(event.error, event.message || '');
            Logger.captureConsole('error', [
                `GlobalError: ${truncateMessage(event.message || 'Unknown error', CONFIG.logging.LOG_REASON_MAX_LEN)}`,
                event.filename ? `(source: ${event.filename.split('/').pop()})` : '',
                Number.isFinite(event.lineno) ? `(line: ${event.lineno})` : '',
                Number.isFinite(event.colno) ? `(col: ${event.colno})` : ''
            ].filter(Boolean).join(' '));

            Logger.add('[INSTRUMENT:ERROR] Global error caught', {
                message: event.message,
                filename: event.filename?.split('/').pop(),
                lineno: event.lineno,
                severity: classification.severity,
                action: classification.action,
                videoState: getVideoState()
            });

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason
                ? truncateMessage(event.reason, CONFIG.logging.LOG_REASON_MAX_LEN)
                : 'Unknown';
            Logger.captureConsole('error', [
                'UnhandledRejection:',
                reason
            ]);
            Logger.add('[INSTRUMENT:REJECTION] Unhandled promise rejection', {
                reason,
                severity: 'MEDIUM',
                videoState: getVideoState()
            });
            Metrics.increment('errors');
        });
    };

    const emitExternalSignal = (signal) => {
        if (!externalSignalHandler) return;
        try {
            externalSignalHandler(signal);
        } catch (e) {
            Logger.add('[INSTRUMENT:ERROR] External signal handler failed', {
                error: e?.name,
                message: e?.message
            });
        }
    };

    const maybeEmitProcessingAsset = (url) => {
        const now = Date.now();
        if (now - lastResourceHintTime < CONFIG.logging.RESOURCE_HINT_THROTTLE_MS) {
            return;
        }
        lastResourceHintTime = now;
        Logger.add('[INSTRUMENT:RESOURCE_HINT] Processing asset requested', {
            url: truncateMessage(url, CONFIG.logging.LOG_URL_MAX_LEN)
        });
        emitExternalSignal({
            type: 'processing_asset',
            level: 'resource',
            message: truncateMessage(url, CONFIG.logging.LOG_URL_MAX_LEN),
            timestamp: new Date().toISOString()
        });
    };

    const logResourceWindow = (detail = {}) => {
        ResourceWindow.logWindow(detail);
    };

    const setupResourceObserver = () => {
        if (typeof window === 'undefined' || !window.PerformanceObserver) return;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry?.name) continue;
                    ResourceWindow.record(entry.name, entry.initiatorType);
                    if (PROCESSING_ASSET_PATTERN.test(entry.name)) {
                        maybeEmitProcessingAsset(entry.name);
                    }
                }
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch (error) {
            Logger.add('[INSTRUMENT:RESOURCE_ERROR] Resource observer failed', {
                error: error?.name,
                message: error?.message
            });
        }
    };

    const consoleInterceptor = ConsoleInterceptor.create({
        onLog: (args) => {
            Logger.captureConsole('log', args);
            const msg = args.map(String).join(' ');
            if (signalDetector) {
                signalDetector.detect('log', msg);
            }
        },
        onInfo: (args) => {
            Logger.captureConsole('info', args);
            const msg = args.map(String).join(' ');
            if (signalDetector) {
                signalDetector.detect('info', msg);
            }
        },
        onDebug: (args) => {
            Logger.captureConsole('debug', args);
            const msg = args.map(String).join(' ');
            if (signalDetector) {
                signalDetector.detect('debug', msg);
            }
        },
        onError: (args) => {
            const msg = args.map(String).join(' ');
            const classification = classifyError(null, msg);

            if (classification.action === 'LOG_ONLY') {
                return;
            }

            Logger.captureConsole('error', args);

            Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                message: truncateMessage(msg, CONFIG.logging.LOG_MESSAGE_MAX_LEN),
                severity: classification.severity,
                action: classification.action
            });

            if (signalDetector) {
                signalDetector.detect('error', msg);
            }

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }
        },
        onWarn: (args) => {
            Logger.captureConsole('warn', args);

            const msg = args.map(String).join(' ');

            if (signalDetector) {
                signalDetector.detect('warn', msg);
            }

            if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                Logger.add('[INSTRUMENT:CSP] CSP warning', {
                    message: truncateMessage(msg, CONFIG.logging.LOG_REASON_MAX_LEN),
                    severity: 'LOW'
                });
            }
        }
    });

    return {
        init: (options = {}) => {
            externalSignalHandler = typeof options.onSignal === 'function'
                ? options.onSignal
                : null;
            signalDetector = ConsoleSignalDetector.create({
                emitSignal: emitExternalSignal
            });
            Logger.add('[INSTRUMENT:INIT] Instrumentation initialized', {
                features: ['globalErrors', 'consoleLogs', 'consoleInfo', 'consoleDebug', 'consoleErrors', 'consoleWarns'],
                consoleCapture: true,
                externalSignals: Boolean(externalSignalHandler)
            });
            setupGlobalErrorHandlers();
            setupResourceObserver();
            consoleInterceptor.attach();
        },
        logResourceWindow
    };
})();



// --- VideoState ---
/**
 * Shared helper for consistent video state logging.
 */
const VideoState = (() => {
    const compactSrc = (src) => {
        if (!src) return '';
        const blobPrefix = 'blob:https://www.twitch.tv/';
        if (src.startsWith(blobPrefix)) {
            const id = src.slice(blobPrefix.length);
            const shortId = id.length > 10
                ? `${id.slice(0, 4)}...${id.slice(-4)}`
                : id;
            return `blob:twitch#${shortId}`;
        }
        if (src.startsWith('blob:')) {
            const id = src.slice('blob:'.length);
            const shortId = id.length > 12
                ? `${id.slice(0, 5)}...${id.slice(-5)}`
                : id;
            return `blob#${shortId}`;
        }
        const maxLen = CONFIG?.logging?.LOG_URL_MAX_LEN || 80;
        if (src.length > maxLen) {
            return src.slice(0, Math.max(maxLen - 3, 0)) + '...';
        }
        return src;
    };

    const withCompactSrc = (snapshot) => {
        if (!snapshot || snapshot.error) return snapshot;
        return {
            ...snapshot,
            currentSrc: compactSrc(snapshot.currentSrc || ''),
            src: compactSrc(snapshot.src || '')
        };
    };

    const getLite = (video, id) => {
        if (!video) return { error: 'NO_VIDEO' };
        let bufferedLength = 0;
        try {
            bufferedLength = video.buffered ? video.buffered.length : 0;
        } catch (error) {
            bufferedLength = 0;
        }
        const duration = Number.isFinite(video.duration)
            ? video.duration.toFixed(3)
            : String(video.duration);
        return {
            id,
            currentTime: video.currentTime?.toFixed(3),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            bufferedLength,
            duration,
            ended: video.ended,
            currentSrc: video.currentSrc || '',
            src: video.getAttribute ? (video.getAttribute('src') || '') : '',
            errorCode: video.error ? video.error.code : null
        };
    };

    const getFull = (video, id) => {
        if (!video) return { error: 'NO_VIDEO' };
        const duration = Number.isFinite(video.duration)
            ? video.duration.toFixed(3)
            : String(video.duration);
        return {
            id,
            currentTime: video.currentTime?.toFixed(3),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
            duration,
            ended: video.ended,
            currentSrc: video.currentSrc || '',
            src: video.getAttribute ? (video.getAttribute('src') || '') : '',
            errorCode: video.error ? video.error.code : null
        };
    };

    return {
        get: getFull,
        getLite,
        getLog: (video, id) => withCompactSrc(getFull(video, id)),
        getLiteLog: (video, id) => withCompactSrc(getLite(video, id)),
        compactSrc
    };
})();

// --- StateSnapshot ---
/**
 * Central helper for consistent video state snapshots.
 */
const StateSnapshot = (() => {
    const full = (video, videoId) => VideoState.get(video, videoId);
    const lite = (video, videoId) => VideoState.getLite(video, videoId);

    const format = (snapshot) => {
        if (!snapshot || snapshot.error) {
            return snapshot?.error || 'unknown';
        }
        const parts = [
            `currentTime=${snapshot.currentTime}`,
            `paused=${snapshot.paused}`,
            `readyState=${snapshot.readyState}`,
            `networkState=${snapshot.networkState}`,
            snapshot.buffered ? `buffered=${snapshot.buffered}` : `bufferedLength=${snapshot.bufferedLength}`
        ];
        return parts.filter(Boolean).join(' ');
    };

    return {
        full,
        lite,
        format
    };
})();

// --- MediaState ---
/**
 * Unified helpers for video state + buffer info.
 */
const MediaState = (() => {
    const full = (video, id) => VideoState.get(video, id);
    const lite = (video, id) => VideoState.getLite(video, id);
    const ranges = (video) => BufferGapFinder.getBufferRanges(video);
    const formattedRanges = (video) => BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video));
    const bufferAhead = (video) => BufferGapFinder.getBufferAhead(video);
    const isBufferExhausted = (video) => BufferGapFinder.isBufferExhausted(video);

    return {
        full,
        lite,
        ranges,
        formattedRanges,
        bufferAhead,
        isBufferExhausted
    };
})();

// --- RecoveryContext ---
/**
 * Shared context wrapper for recovery flows.
 */
const RecoveryContext = (() => {
    const create = (video, monitorState, getVideoId, detail = {}) => {
        const videoId = detail.videoId || (typeof getVideoId === 'function'
            ? getVideoId(video)
            : 'unknown');
        const now = Number.isFinite(detail.now) ? detail.now : Date.now();
        return {
            video,
            monitorState,
            videoId,
            now,
            trigger: detail.trigger || null,
            reason: detail.reason || null,
            detail,
            getSnapshot: () => StateSnapshot.full(video, videoId),
            getLiteSnapshot: () => StateSnapshot.lite(video, videoId),
            getRanges: () => BufferGapFinder.getBufferRanges(video),
            getRangesFormatted: () => BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
            getBufferAhead: () => BufferGapFinder.getBufferAhead(video)
        };
    };

    const from = (videoOrContext, monitorState, getVideoId, detail = {}) => {
        if (videoOrContext && typeof videoOrContext === 'object' && videoOrContext.video) {
            return videoOrContext;
        }
        return create(videoOrContext, monitorState, getVideoId, detail);
    };

    return {
        create,
        from
    };
})();

// --- PlaybackStateTracker ---
/**
 * Shared playback state tracking for PlaybackMonitor.
 */
const PlaybackStateTracker = (() => {
    const PROGRESS_EPSILON = 0.05;

    const defineAlias = (target, key, path) => {
        Object.defineProperty(target, key, {
            configurable: true,
            get: () => path.reduce((ref, segment) => ref[segment], target),
            set: (value) => {
                let ref = target;
                for (let i = 0; i < path.length - 1; i++) {
                    ref = ref[path[i]];
                }
                ref[path[path.length - 1]] = value;
            }
        });
    };

    const applyAliases = (target, map) => {
        Object.entries(map).forEach(([key, path]) => defineAlias(target, key, path));
    };

    const create = (video, videoId, logDebug) => {
        const state = {
            status: {
                value: 'PLAYING'
            },
            progress: {
                lastProgressTime: 0,
                lastTime: video.currentTime,
                progressStartTime: null,
                progressStreakMs: 0,
                progressEligible: false,
                hasProgress: false,
                firstSeenTime: Date.now(),
                firstReadyTime: 0,
                initialProgressTimeoutLogged: false,
                initLogEmitted: false
            },
            heal: {
                noHealPointCount: 0,
                nextHealAllowedTime: 0,
                playErrorCount: 0,
                nextPlayHealAllowedTime: 0,
                lastPlayErrorTime: 0,
                lastPlayBackoffLogTime: 0,
                lastHealPointKey: null,
                healPointRepeatCount: 0,
                lastBackoffLogTime: 0,
                lastHealAttemptTime: 0,
                lastHealDeferralLogTime: 0,
                lastRefreshAt: 0
            },
            events: {
                lastWatchdogLogTime: 0,
                lastNonActiveEventLogTime: 0,
                nonActiveEventCounts: {},
                lastActiveEventLogTime: 0,
                lastActiveEventSummaryTime: 0,
                activeEventCounts: {}
            },
            media: {
                lastSrc: video.currentSrc || video.getAttribute('src') || '',
                lastSrcAttr: video.getAttribute ? (video.getAttribute('src') || '') : '',
                lastReadyState: video.readyState,
                lastNetworkState: video.networkState,
                lastSrcChangeTime: 0,
                lastReadyStateChangeTime: 0,
                lastNetworkStateChangeTime: 0,
                lastBufferedLengthChangeTime: 0,
                lastBufferedLength: (() => {
                    try {
                        return video.buffered ? video.buffered.length : 0;
                    } catch (error) {
                        return 0;
                    }
                })(),
                mediaStateVerboseLogged: false
            },
            stall: {
                lastStallEventTime: 0,
                pauseFromStall: false,
                stallStartTime: 0,
                bufferStarvedSince: 0,
                bufferStarved: false,
                bufferStarveUntil: 0,
                lastBufferStarveLogTime: 0,
                lastBufferStarveSkipLogTime: 0,
                lastBufferStarveRescanTime: 0,
                lastBufferAhead: null,
                lastBufferAheadUpdateTime: 0,
                lastBufferAheadIncreaseTime: 0,
                lastSelfRecoverSkipLogTime: 0,
                lastAdGapSignatureLogTime: 0,
                lastResourceWindowLogTime: 0
            },
            sync: {
                lastSyncWallTime: 0,
                lastSyncMediaTime: 0,
                lastSyncLogTime: 0
            },
            reset: {
                resetPendingAt: 0,
                resetPendingReason: null,
                resetPendingType: null,
                resetPendingCallback: null
            },
            catchUp: {
                catchUpTimeoutId: null,
                catchUpAttempts: 0,
                lastCatchUpTime: 0
            }
        };

        applyAliases(state, {
            state: ['status', 'value'],
            lastProgressTime: ['progress', 'lastProgressTime'],
            lastTime: ['progress', 'lastTime'],
            progressStartTime: ['progress', 'progressStartTime'],
            progressStreakMs: ['progress', 'progressStreakMs'],
            progressEligible: ['progress', 'progressEligible'],
            hasProgress: ['progress', 'hasProgress'],
            firstSeenTime: ['progress', 'firstSeenTime'],
            firstReadyTime: ['progress', 'firstReadyTime'],
            initialProgressTimeoutLogged: ['progress', 'initialProgressTimeoutLogged'],
            initLogEmitted: ['progress', 'initLogEmitted'],
            noHealPointCount: ['heal', 'noHealPointCount'],
            nextHealAllowedTime: ['heal', 'nextHealAllowedTime'],
            playErrorCount: ['heal', 'playErrorCount'],
            nextPlayHealAllowedTime: ['heal', 'nextPlayHealAllowedTime'],
            lastPlayErrorTime: ['heal', 'lastPlayErrorTime'],
            lastPlayBackoffLogTime: ['heal', 'lastPlayBackoffLogTime'],
            lastHealPointKey: ['heal', 'lastHealPointKey'],
            healPointRepeatCount: ['heal', 'healPointRepeatCount'],
            lastBackoffLogTime: ['heal', 'lastBackoffLogTime'],
            lastHealAttemptTime: ['heal', 'lastHealAttemptTime'],
            lastHealDeferralLogTime: ['heal', 'lastHealDeferralLogTime'],
            lastRefreshAt: ['heal', 'lastRefreshAt'],
            lastWatchdogLogTime: ['events', 'lastWatchdogLogTime'],
            lastNonActiveEventLogTime: ['events', 'lastNonActiveEventLogTime'],
            nonActiveEventCounts: ['events', 'nonActiveEventCounts'],
            lastActiveEventLogTime: ['events', 'lastActiveEventLogTime'],
            lastActiveEventSummaryTime: ['events', 'lastActiveEventSummaryTime'],
            activeEventCounts: ['events', 'activeEventCounts'],
            lastSrc: ['media', 'lastSrc'],
            lastSrcAttr: ['media', 'lastSrcAttr'],
            lastReadyState: ['media', 'lastReadyState'],
            lastNetworkState: ['media', 'lastNetworkState'],
            lastSrcChangeTime: ['media', 'lastSrcChangeTime'],
            lastReadyStateChangeTime: ['media', 'lastReadyStateChangeTime'],
            lastNetworkStateChangeTime: ['media', 'lastNetworkStateChangeTime'],
            lastBufferedLengthChangeTime: ['media', 'lastBufferedLengthChangeTime'],
            lastBufferedLength: ['media', 'lastBufferedLength'],
            mediaStateVerboseLogged: ['media', 'mediaStateVerboseLogged'],
            lastStallEventTime: ['stall', 'lastStallEventTime'],
            pauseFromStall: ['stall', 'pauseFromStall'],
            stallStartTime: ['stall', 'stallStartTime'],
            bufferStarvedSince: ['stall', 'bufferStarvedSince'],
            bufferStarved: ['stall', 'bufferStarved'],
            bufferStarveUntil: ['stall', 'bufferStarveUntil'],
            lastBufferStarveLogTime: ['stall', 'lastBufferStarveLogTime'],
            lastBufferStarveSkipLogTime: ['stall', 'lastBufferStarveSkipLogTime'],
            lastBufferStarveRescanTime: ['stall', 'lastBufferStarveRescanTime'],
            lastBufferAhead: ['stall', 'lastBufferAhead'],
            lastBufferAheadUpdateTime: ['stall', 'lastBufferAheadUpdateTime'],
            lastBufferAheadIncreaseTime: ['stall', 'lastBufferAheadIncreaseTime'],
            lastSelfRecoverSkipLogTime: ['stall', 'lastSelfRecoverSkipLogTime'],
            lastAdGapSignatureLogTime: ['stall', 'lastAdGapSignatureLogTime'],
            lastResourceWindowLogTime: ['stall', 'lastResourceWindowLogTime'],
            lastSyncWallTime: ['sync', 'lastSyncWallTime'],
            lastSyncMediaTime: ['sync', 'lastSyncMediaTime'],
            lastSyncLogTime: ['sync', 'lastSyncLogTime'],
            resetPendingAt: ['reset', 'resetPendingAt'],
            resetPendingReason: ['reset', 'resetPendingReason'],
            resetPendingType: ['reset', 'resetPendingType'],
            resetPendingCallback: ['reset', 'resetPendingCallback'],
            catchUpTimeoutId: ['catchUp', 'catchUpTimeoutId'],
            catchUpAttempts: ['catchUp', 'catchUpAttempts'],
            lastCatchUpTime: ['catchUp', 'lastCatchUpTime']
        });

        const logDebugLazy = (messageOrFactory, detailFactory) => {
            if (!CONFIG.debug) return;
            if (typeof messageOrFactory === 'function') {
                const result = messageOrFactory();
                if (!result) return;
                logDebug(result.message, result.detail || {});
                return;
            }
            logDebug(messageOrFactory, detailFactory ? detailFactory() : {});
        };

        const getCurrentTime = () => (
            Number.isFinite(video.currentTime) ? Number(video.currentTime.toFixed(3)) : null
        );

        const evaluateResetState = (vs) => {
            const ranges = BufferGapFinder.getBufferRanges(video);
            const hasBuffer = ranges.length > 0;
            const hasSrc = Boolean(vs.currentSrc || vs.src);
            const lowReadyState = vs.readyState <= 1;
            const isHardReset = !hasSrc && lowReadyState;
            const isSoftReset = lowReadyState
                && !hasBuffer
                && (vs.networkState === 0 || vs.networkState === 3);

            return {
                ranges,
                hasBuffer,
                hasSrc,
                lowReadyState,
                isHardReset,
                isSoftReset
            };
        };

        const clearResetPending = (reason, vs) => {
            if (!state.resetPendingAt) return false;
            const now = Date.now();
            logDebugLazy(() => {
                const snapshot = vs || VideoState.get(video, videoId);
                return {
                    message: LogEvents.tagged('RESET_CLEAR', 'Reset pending cleared'),
                    detail: {
                        reason,
                        pendingForMs: now - state.resetPendingAt,
                        graceMs: CONFIG.stall.RESET_GRACE_MS,
                        resetType: state.resetPendingType,
                        hasSrc: Boolean(snapshot.currentSrc || snapshot.src),
                        readyState: snapshot.readyState,
                        networkState: snapshot.networkState,
                        buffered: snapshot.buffered || BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    }
                };
            });
            state.resetPendingAt = 0;
            state.resetPendingReason = null;
            state.resetPendingType = null;
            state.resetPendingCallback = null;
            return true;
        };

        const updateProgress = (reason) => {
            const now = Date.now();
            const timeDelta = video.currentTime - state.lastTime;
            const progressGapMs = state.lastProgressTime
                ? now - state.lastProgressTime
                : null;

            state.lastTime = video.currentTime;

            if (video.paused || timeDelta <= PROGRESS_EPSILON) {
                return;
            }

            if (state.stallStartTime) {
                const stallDurationMs = now - state.stallStartTime;
                state.stallStartTime = 0;
                Metrics.recordStallDuration(stallDurationMs, {
                    videoId,
                    reason,
                    bufferAhead: state.lastBufferAhead
                });
                logDebugLazy(() => {
                    const snapshot = StateSnapshot.lite(video, videoId);
                    const summary = LogEvents.summary.stallDuration({
                        videoId,
                        reason,
                        durationMs: stallDurationMs,
                        bufferAhead: state.lastBufferAhead,
                        currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                        readyState: snapshot?.readyState,
                        networkState: snapshot?.networkState,
                        buffered: snapshot?.bufferedLength
                    });
                    return {
                        message: summary,
                        detail: {
                            reason,
                            durationMs: stallDurationMs,
                            bufferAhead: state.lastBufferAhead,
                            currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                            readyState: snapshot?.readyState,
                            networkState: snapshot?.networkState,
                            buffered: snapshot?.buffered
                        }
                    };
                });
            }

            if (!state.progressStartTime
                || (progressGapMs !== null && progressGapMs > CONFIG.monitoring.PROGRESS_STREAK_RESET_MS)) {
                if (state.progressStartTime) {
                    logDebugLazy(LogEvents.tagged('PROGRESS', 'Progress streak reset'), () => ({
                        reason,
                        progressGapMs,
                        previousStreakMs: state.progressStreakMs,
                        currentTime: getCurrentTime()
                    }));
                }
                state.progressStartTime = now;
                state.progressStreakMs = 0;
                state.progressEligible = false;
            } else {
                state.progressStreakMs = now - state.progressStartTime;
            }

            state.lastProgressTime = now;
            state.pauseFromStall = false;
            if (state.resetPendingAt) {
                clearResetPending('progress');
            }

            if (!state.progressEligible
                && state.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS) {
                state.progressEligible = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Candidate eligibility reached'), () => ({
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                    currentTime: getCurrentTime()
                }));
            }

            if (!state.hasProgress) {
                state.hasProgress = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Initial progress observed'), () => ({
                    reason,
                    currentTime: getCurrentTime()
                }));
            }

            if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
                logDebugLazy(LogEvents.tagged('BACKOFF', 'Cleared after progress'), () => ({
                    reason,
                    previousNoHealPoints: state.noHealPointCount,
                    previousNextHealAllowedMs: state.nextHealAllowedTime
                        ? (state.nextHealAllowedTime - now)
                        : 0
                }));
                state.noHealPointCount = 0;
                state.nextHealAllowedTime = 0;
            }

            if (state.playErrorCount > 0 || state.nextPlayHealAllowedTime > 0 || state.healPointRepeatCount > 0) {
                logDebugLazy(LogEvents.tagged('PLAY_BACKOFF', 'Cleared after progress'), () => ({
                    reason,
                    previousPlayErrors: state.playErrorCount,
                    previousNextPlayAllowedMs: state.nextPlayHealAllowedTime
                        ? (state.nextPlayHealAllowedTime - now)
                        : 0,
                    previousHealPointRepeats: state.healPointRepeatCount
                }));
                state.playErrorCount = 0;
                state.nextPlayHealAllowedTime = 0;
                state.lastPlayErrorTime = 0;
                state.lastPlayBackoffLogTime = 0;
                state.lastHealPointKey = null;
                state.healPointRepeatCount = 0;
            }

            if (state.bufferStarved || state.bufferStarvedSince) {
                logDebugLazy(LogEvents.tagged('STARVE_CLEAR', 'Buffer starvation cleared by progress'), () => ({
                    reason,
                    bufferStarvedSinceMs: state.bufferStarvedSince
                        ? (now - state.bufferStarvedSince)
                        : null
                }));
                state.bufferStarved = false;
                state.bufferStarvedSince = 0;
                state.bufferStarveUntil = 0;
                state.lastBufferStarveLogTime = 0;
                state.lastBufferStarveSkipLogTime = 0;
            }
        };

        const markReady = (reason) => {
            if (state.firstReadyTime) return;
            const src = video.currentSrc || video.getAttribute('src') || '';
            if (!src && video.readyState < 1) {
                return;
            }
            state.firstReadyTime = Date.now();
            logDebugLazy(LogEvents.tagged('READY', 'Initial ready state observed'), () => ({
                reason,
                readyState: video.readyState,
                currentSrc: VideoState.compactSrc(src)
            }));
            if (state.resetPendingAt) {
                const vs = VideoState.get(video, videoId);
                const resetState = evaluateResetState(vs);
                if (!resetState.isHardReset && !resetState.isSoftReset) {
                    clearResetPending('ready', vs);
                }
            }
        };

        const markStallEvent = (reason) => {
            state.lastStallEventTime = Date.now();
            if (!state.stallStartTime) {
                state.stallStartTime = state.lastStallEventTime;
            }
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
                logDebugLazy(LogEvents.tagged('STALL', 'Marked paused due to stall'), () => ({
                    reason,
                    currentTime: getCurrentTime()
                }));
            }
        };

        const handleReset = (reason, onReset) => {
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            logDebugLazy(LogEvents.tagged('RESET_CHECK', 'Reset evaluation'), () => ({
                reason,
                hasSrc: resetState.hasSrc,
                readyState: vs.readyState,
                networkState: vs.networkState,
                bufferRanges: BufferGapFinder.formatRanges(resetState.ranges),
                lastSrc: state.lastSrc,
                hardReset: resetState.isHardReset,
                softReset: resetState.isSoftReset
            }));

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                logDebugLazy(LogEvents.tagged('RESET_SKIP', 'Reset suppressed'), () => ({
                    reason,
                    hasSrc: resetState.hasSrc,
                    readyState: vs.readyState,
                    networkState: vs.networkState,
                    hasBuffer: resetState.hasBuffer
                }));
                return;
            }

            if (!state.resetPendingAt) {
                state.resetPendingAt = Date.now();
                state.resetPendingReason = reason;
                state.resetPendingType = resetState.isHardReset ? 'hard' : 'soft';
                logDebugLazy(LogEvents.tagged('RESET_PENDING', 'Reset pending'), () => ({
                    reason,
                    resetType: state.resetPendingType,
                    graceMs: CONFIG.stall.RESET_GRACE_MS,
                    hasSrc: resetState.hasSrc,
                    hasBuffer: resetState.hasBuffer,
                    readyState: vs.readyState,
                    networkState: vs.networkState
                }));
            }
            state.resetPendingCallback = onReset;
        };

        const evaluateResetPending = (trigger) => {
            if (!state.resetPendingAt) {
                return false;
            }
            const now = Date.now();
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                clearResetPending(trigger || 'recovered', vs);
                return false;
            }

            const pendingForMs = now - state.resetPendingAt;
            if (pendingForMs < CONFIG.stall.RESET_GRACE_MS) {
                return true;
            }

            const pendingReason = state.resetPendingReason || trigger;
            const pendingType = state.resetPendingType || (resetState.isHardReset ? 'hard' : 'soft');

            state.state = 'RESET';
            logDebugLazy(LogEvents.tagged('RESET', 'Video reset'), () => ({
                reason: pendingReason,
                resetType: pendingType,
                pendingForMs,
                graceMs: CONFIG.stall.RESET_GRACE_MS,
                hasSrc: resetState.hasSrc,
                hasBuffer: resetState.hasBuffer,
                readyState: vs.readyState,
                networkState: vs.networkState
            }));

            const callback = state.resetPendingCallback;
            state.resetPendingAt = 0;
            state.resetPendingReason = null;
            state.resetPendingType = null;
            state.resetPendingCallback = null;

            if (typeof callback === 'function') {
                callback({
                    reason: pendingReason,
                    resetType: pendingType,
                    pendingForMs,
                    videoState: vs
                }, state);
            }

            return true;
        };

        const shouldSkipUntilProgress = () => {
            if (!state.hasProgress) {
                const now = Date.now();
                markReady('watchdog_ready_check');
                const graceMs = CONFIG.stall.INIT_PROGRESS_GRACE_MS || CONFIG.stall.STALL_CONFIRM_MS;
                const baselineTime = state.firstReadyTime || state.firstSeenTime;
                const waitingForProgress = (now - baselineTime) < graceMs;

                if (waitingForProgress) {
                    if (!state.initLogEmitted) {
                        state.initLogEmitted = true;
                        logDebugLazy(LogEvents.tagged('WATCHDOG', 'Awaiting initial progress'), () => ({
                            state: state.state,
                            graceMs,
                            baseline: state.firstReadyTime ? 'ready' : 'seen'
                        }));
                    }
                    return true;
                }

                if (!state.initialProgressTimeoutLogged) {
                    state.initialProgressTimeoutLogged = true;
                    logDebugLazy(LogEvents.tagged('WATCHDOG', 'Initial progress timeout'), () => ({
                        state: state.state,
                        waitedMs: now - baselineTime,
                        graceMs,
                        baseline: state.firstReadyTime ? 'ready' : 'seen'
                    }));
                }

                return false;
            }
            return false;
        };

        const logSyncStatus = () => {
            const now = Date.now();
            if (video.paused || video.readyState < 2) {
                return;
            }
            if (!state.lastSyncWallTime) {
                state.lastSyncWallTime = now;
                state.lastSyncMediaTime = video.currentTime;
                return;
            }
            const wallDelta = now - state.lastSyncWallTime;
            if (wallDelta < CONFIG.monitoring.SYNC_SAMPLE_MS) {
                return;
            }
            const mediaDelta = (video.currentTime - state.lastSyncMediaTime) * 1000;
            state.lastSyncWallTime = now;
            state.lastSyncMediaTime = video.currentTime;

            if (wallDelta <= 0) {
                return;
            }

            const rate = mediaDelta / wallDelta;
            const driftMs = wallDelta - mediaDelta;
            const ranges = BufferGapFinder.getBufferRanges(video);
            const bufferEndDelta = ranges.length
                ? (ranges[ranges.length - 1].end - video.currentTime)
                : null;

            const shouldLog = (now - state.lastSyncLogTime >= CONFIG.logging.SYNC_LOG_MS)
                || driftMs >= CONFIG.monitoring.SYNC_DRIFT_MAX_MS
                || rate <= CONFIG.monitoring.SYNC_RATE_MIN;

            if (!shouldLog) {
                return;
            }
            state.lastSyncLogTime = now;
            logDebugLazy(LogEvents.tagged('SYNC', 'Playback drift sample'), () => ({
                wallDeltaMs: wallDelta,
                mediaDeltaMs: Math.round(mediaDelta),
                driftMs: Math.round(driftMs),
                rate: Number.isFinite(rate) ? rate.toFixed(3) : null,
                bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null
            }));
        };

        const updateBufferStarvation = (bufferInfo, reason, nowOverride) => {
            const now = Number.isFinite(nowOverride) ? nowOverride : Date.now();
            if (!bufferInfo) return false;

            let bufferAhead = bufferInfo.bufferAhead;
            if (!Number.isFinite(bufferAhead)) {
                if (bufferInfo.hasBuffer) {
                    bufferAhead = 0;
                } else {
                    state.lastBufferAhead = null;
                    return false;
                }
            }

            const prevBufferAhead = state.lastBufferAhead;
            state.lastBufferAhead = bufferAhead;
            state.lastBufferAheadUpdateTime = now;
            if (Number.isFinite(bufferAhead)) {
                if (Number.isFinite(prevBufferAhead)) {
                    if (bufferAhead > prevBufferAhead + 0.05) {
                        state.lastBufferAheadIncreaseTime = now;
                    }
                } else if (bufferAhead > 0) {
                    state.lastBufferAheadIncreaseTime = now;
                }
            }

            if (bufferAhead <= CONFIG.stall.BUFFER_STARVE_THRESHOLD_S) {
                if (!state.bufferStarvedSince) {
                    state.bufferStarvedSince = now;
                }

                const starvedForMs = now - state.bufferStarvedSince;
                if (!state.bufferStarved && starvedForMs >= CONFIG.stall.BUFFER_STARVE_CONFIRM_MS) {
                    state.bufferStarved = true;
                    state.bufferStarveUntil = now + CONFIG.stall.BUFFER_STARVE_BACKOFF_MS;
                    state.lastBufferStarveLogTime = now;
                    logDebugLazy(LogEvents.tagged('STARVE', 'Buffer starvation detected'), () => ({
                        reason,
                        bufferAhead: bufferAhead.toFixed(3),
                        threshold: CONFIG.stall.BUFFER_STARVE_THRESHOLD_S,
                        confirmMs: CONFIG.stall.BUFFER_STARVE_CONFIRM_MS,
                        backoffMs: CONFIG.stall.BUFFER_STARVE_BACKOFF_MS
                    }));
                } else if (state.bufferStarved
                    && (now - state.lastBufferStarveLogTime) >= CONFIG.logging.STARVE_LOG_MS) {
                    state.lastBufferStarveLogTime = now;
                    if (now >= state.bufferStarveUntil) {
                        state.bufferStarveUntil = now + CONFIG.stall.BUFFER_STARVE_BACKOFF_MS;
                    }
                    logDebugLazy(LogEvents.tagged('STARVE', 'Buffer starvation persists'), () => ({
                        reason,
                        bufferAhead: bufferAhead.toFixed(3),
                        starvedForMs,
                        nextHealAllowedInMs: Math.max(state.bufferStarveUntil - now, 0)
                    }));
                }
                return state.bufferStarved;
            }

            if (state.bufferStarved || state.bufferStarvedSince) {
                const starvedForMs = state.bufferStarvedSince ? (now - state.bufferStarvedSince) : null;
                state.bufferStarved = false;
                state.bufferStarvedSince = 0;
                state.bufferStarveUntil = 0;
                state.lastBufferStarveLogTime = 0;
                state.lastBufferStarveSkipLogTime = 0;
                logDebugLazy(LogEvents.tagged('STARVE_CLEAR', 'Buffer starvation cleared'), () => ({
                    reason,
                    starvedForMs,
                    bufferAhead: bufferAhead.toFixed(3)
                }));
            }

            return false;
        };

        return {
            state,
            updateProgress,
            markStallEvent,
            markReady,
            handleReset,
            shouldSkipUntilProgress,
            evaluateResetPending,
            clearResetPending,
            logSyncStatus,
            updateBufferStarvation
        };
    };

    return { create };
})();


// --- PlaybackEventHandlers ---
/**
 * Wires media element events to playback state tracking.
 */
const PlaybackEventHandlers = (() => {
    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const onReset = options.onReset || (() => {});
        const isActive = options.isActive || (() => true);

        const ALWAYS_LOG_EVENTS = new Set(['abort', 'emptied', 'error', 'ended']);

        const logEvent = (event, detailFactory = null) => {
            if (!CONFIG.debug) return;
            const now = Date.now();
            const detail = typeof detailFactory === 'function'
                ? detailFactory()
                : (detailFactory || {});

            if (ALWAYS_LOG_EVENTS.has(event)) {
                logDebug(LogEvents.tagged('EVENT', event), detail);
                return;
            }

            if (isActive()) {
                const counts = state.activeEventCounts || {};
                counts[event] = (counts[event] || 0) + 1;
                state.activeEventCounts = counts;

                const lastActive = state.lastActiveEventLogTime || 0;
                if (now - lastActive >= CONFIG.logging.ACTIVE_EVENT_LOG_MS) {
                    state.lastActiveEventLogTime = now;
                    logDebug(LogEvents.tagged('EVENT', event), detail);
                }

                const lastSummary = state.lastActiveEventSummaryTime || 0;
                if (now - lastSummary >= CONFIG.logging.ACTIVE_EVENT_SUMMARY_MS) {
                    state.lastActiveEventSummaryTime = now;
                    const summary = { ...counts };
                    state.activeEventCounts = {};
                    logDebug(LogEvents.tagged('EVENT_SUMMARY', 'Active'), {
                        events: summary,
                        sinceMs: lastSummary ? (now - lastSummary) : null,
                        state: state.state
                    });
                }
                return;
            }

            const counts = state.nonActiveEventCounts || {};
            counts[event] = (counts[event] || 0) + 1;
            state.nonActiveEventCounts = counts;

            const lastLog = state.lastNonActiveEventLogTime || 0;
            if (now - lastLog < CONFIG.logging.NON_ACTIVE_LOG_MS) {
                return;
            }

            state.lastNonActiveEventLogTime = now;
            const summary = { ...counts };
            state.nonActiveEventCounts = {};

            logDebug(LogEvents.tagged('EVENT_SUMMARY', 'Non-active'), {
                events: summary,
                sinceMs: lastLog ? (now - lastLog) : null,
                state: state.state
            });
        };

        const handlers = {
            timeupdate: () => {
                tracker.updateProgress('timeupdate');
                if (state.state !== 'PLAYING') {
                logEvent('timeupdate', () => ({
                    state: state.state
                }));
                }
                if (!video.paused && state.state !== 'HEALING') {
                    setState('PLAYING', 'timeupdate');
                }
            },
            playing: () => {
                tracker.markReady('playing');
                state.pauseFromStall = false;
                state.lastTime = video.currentTime;
                logEvent('playing', () => ({
                    state: state.state
                }));
                if (state.state !== 'HEALING') {
                    setState('PLAYING', 'playing');
                }
            },
            loadedmetadata: () => {
                tracker.markReady('loadedmetadata');
                logEvent('loadedmetadata', () => ({
                    state: state.state
                }));
            },
            loadeddata: () => {
                tracker.markReady('loadeddata');
                logEvent('loadeddata', () => ({
                    state: state.state
                }));
            },
            canplay: () => {
                tracker.markReady('canplay');
                logEvent('canplay', () => ({
                    state: state.state
                }));
            },
            waiting: () => {
                tracker.markStallEvent('waiting');
                logEvent('waiting', () => ({
                    state: state.state
                }));
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'waiting');
                }
            },
            stalled: () => {
                tracker.markStallEvent('stalled');
                logEvent('stalled', () => ({
                    state: state.state
                }));
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'stalled');
                }
            },
            pause: () => {
                const bufferExhausted = MediaState.isBufferExhausted(video);
                logEvent('pause', () => ({
                    state: state.state,
                    bufferExhausted
                }));
                if (bufferExhausted && !video.ended) {
                    tracker.markStallEvent('pause_buffer_exhausted');
                    if (state.state !== 'HEALING') {
                        setState('STALLED', 'pause_buffer_exhausted');
                    }
                    return;
                }
                setState('PAUSED', 'pause');
            },
            ended: () => {
                state.pauseFromStall = false;
                logEvent('ended', () => ({
                    state: state.state
                }));
                Logger.add(LogEvents.tagged('ENDED', 'Video ended'), {
                    videoId,
                    currentTime: Number.isFinite(video.currentTime)
                        ? Number(video.currentTime.toFixed(3))
                        : null
                });
                setState('ENDED', 'ended');
            },
            error: () => {
                state.pauseFromStall = false;
                logEvent('error', () => ({
                    state: state.state
                }));
                setState('ERROR', 'error');
            },
            abort: () => {
                state.pauseFromStall = false;
                logEvent('abort', () => ({
                    state: state.state
                }));
                setState('PAUSED', 'abort');
                tracker.handleReset('abort', onReset);
            },
            emptied: () => {
                state.pauseFromStall = false;
                logEvent('emptied', () => ({
                    state: state.state
                }));
                tracker.handleReset('emptied', onReset);
            },
            suspend: () => {
                logEvent('suspend', () => ({
                    state: state.state
                }));
            }
        };

        const attach = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.addEventListener(event, handler);
            });
        };

        const detach = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.removeEventListener(event, handler);
            });
        };

        return {
            attach,
            detach
        };
    };

    return { create };
})();

// --- PlaybackWatchdog ---
/**
 * Watchdog interval that evaluates stalled playback state.
 */
const PlaybackWatchdog = (() => {
    const LOG = {
        WATCHDOG: LogEvents.TAG.WATCHDOG
    };

    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const isHealing = options.isHealing;
        const isActive = options.isActive || (() => true);
        const onRemoved = options.onRemoved || (() => {});
        const onStall = options.onStall || (() => {});

        let intervalId;

        const formatMediaValue = (value) => {
            if (typeof value === 'string') {
                if (!value) return '""';
                const compacted = VideoState.compactSrc(value);
                const maxLen = 80;
                if (compacted.length > maxLen) {
                    return `"${compacted.slice(0, maxLen - 3)}..."`;
                }
                return `"${compacted}"`;
            }
            if (value === null) return 'null';
            if (value === undefined) return 'undefined';
            return value;
        };

        const logMediaStateChange = (label, previous, current, snapshot) => {
            if (!state.mediaStateVerboseLogged) {
                logDebug(LogEvents.tagged('MEDIA_STATE', `${label} changed`), {
                    previous,
                    current,
                    videoState: snapshot
                });
                state.mediaStateVerboseLogged = true;
                return;
            }
            logDebug(LogEvents.tagged('MEDIA_STATE', `${label} changed ${formatMediaValue(previous)} -> ${formatMediaValue(current)}`));
        };

        const tick = () => {
            const now = Date.now();
            if (!document.contains(video)) {
                Logger.add(LogEvents.tagged('CLEANUP', 'Video removed from DOM'), {
                    videoId
                });
                onRemoved();
                return;
            }

            tracker.evaluateResetPending('watchdog');
            if (state.resetPendingAt) {
                return;
            }

            if (isHealing()) {
                return;
            }

            const bufferExhausted = MediaState.isBufferExhausted(video);
            const pausedAfterStall = state.lastStallEventTime > 0
                && (now - state.lastStallEventTime) < CONFIG.stall.PAUSED_STALL_GRACE_MS;
            let pauseFromStall = state.pauseFromStall || pausedAfterStall;
            if (video.paused && bufferExhausted && !pauseFromStall) {
                tracker.markStallEvent('watchdog_pause_buffer_exhausted');
                pauseFromStall = true;
            }
            if (video.paused && !pauseFromStall) {
                setState('PAUSED', 'watchdog_paused');
                return;
            }
            if (video.paused && pauseFromStall && state.state !== 'STALLED') {
                setState('STALLED', bufferExhausted ? 'paused_buffer_exhausted' : 'paused_after_stall');
            }

            if (tracker.shouldSkipUntilProgress()) {
                return;
            }

            if (isActive()) {
                const bufferInfo = MediaState.bufferAhead(video);
                tracker.updateBufferStarvation(bufferInfo, 'watchdog');
            }

            const currentSrc = video.currentSrc || video.getAttribute('src') || '';
            if (currentSrc !== state.lastSrc) {
                logDebug(LogEvents.tagged('SRC', 'Source changed'), {
                    previous: VideoState.compactSrc(state.lastSrc),
                    current: VideoState.compactSrc(currentSrc),
                    videoState: VideoState.getLog(video, videoId)
                });
                state.lastSrc = currentSrc;
                state.lastSrcChangeTime = now;
            }

            const srcAttr = video.getAttribute ? (video.getAttribute('src') || '') : '';
            if (srcAttr !== state.lastSrcAttr) {
                logMediaStateChange('src attribute', state.lastSrcAttr, srcAttr, VideoState.getLiteLog(video, videoId));
                state.lastSrcAttr = srcAttr;
            }

            const readyState = video.readyState;
            if (readyState !== state.lastReadyState) {
                logMediaStateChange('readyState', state.lastReadyState, readyState, VideoState.getLiteLog(video, videoId));
                state.lastReadyState = readyState;
                state.lastReadyStateChangeTime = now;
            }

            const networkState = video.networkState;
            if (networkState !== state.lastNetworkState) {
                logMediaStateChange('networkState', state.lastNetworkState, networkState, VideoState.getLiteLog(video, videoId));
                state.lastNetworkState = networkState;
                state.lastNetworkStateChangeTime = now;
            }

            let bufferedLength = 0;
            try {
                bufferedLength = video.buffered ? video.buffered.length : 0;
            } catch (error) {
                bufferedLength = state.lastBufferedLength;
            }
            if (bufferedLength !== state.lastBufferedLength) {
                logMediaStateChange('buffered range count', state.lastBufferedLength, bufferedLength, VideoState.getLiteLog(video, videoId));
                state.lastBufferedLength = bufferedLength;
                state.lastBufferedLengthChangeTime = now;
            }

            tracker.logSyncStatus();

            const lastProgressTime = state.lastProgressTime || state.firstSeenTime || now;
            const stalledForMs = now - lastProgressTime;
            if (stalledForMs < CONFIG.stall.STALL_CONFIRM_MS) {
                return;
            }

            const confirmMs = Tuning.stallConfirmMs(bufferExhausted);

            if (stalledForMs < confirmMs) {
                return;
            }

            if (state.state !== 'STALLED') {
                setState('STALLED', 'watchdog_no_progress');
            }

            const logIntervalMs = Tuning.logIntervalMs(isActive());
            if (now - state.lastWatchdogLogTime > logIntervalMs) {
                state.lastWatchdogLogTime = now;
                const snapshot = StateSnapshot.full(video, videoId);
                const summary = LogEvents.summary.watchdogNoProgress({
                    videoId,
                    stalledForMs,
                    bufferExhausted,
                    state: state.state,
                    paused: video.paused,
                    pauseFromStall,
                    currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                    readyState: snapshot?.readyState,
                    networkState: snapshot?.networkState,
                    buffered: snapshot?.buffered
                });
                logDebug(summary, {
                    stalledForMs,
                    bufferExhausted,
                    state: state.state,
                    paused: video.paused,
                    pauseFromStall
                });
            }

            onStall({
                trigger: 'WATCHDOG',
                stalledFor: stalledForMs + 'ms',
                bufferExhausted,
                paused: video.paused,
                pauseFromStall
            }, state);
        };

        const start = () => {
            intervalId = setInterval(tick, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stop = () => {
            if (intervalId !== undefined) {
                clearInterval(intervalId);
            }
        };

        return { start, stop };
    };

    return { create };
})();

// --- PlaybackMonitor ---
/**
 * Tracks playback progress using media events plus a watchdog interval.
 * Emits stall detection callbacks while keeping event/state logging centralized.
 */
const PlaybackMonitor = (() => {
    const LOG = {
        STATE: LogEvents.TAG.STATE
    };

    const create = (video, options = {}) => {
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});
        const onRemoved = options.onRemoved || (() => {});
        const onReset = options.onReset || (() => {});
        const isActive = options.isActive || (() => true);
        const videoId = options.videoId || 'unknown';

        const logDebug = (message, detail) => {
            if (CONFIG.debug) {
                Logger.add(message, {
                    videoId,
                    ...detail
                });
            }
        };

        const tracker = PlaybackStateTracker.create(video, videoId, logDebug);
        const state = tracker.state;

        const setState = (nextState, reason) => {
            if (state.state === nextState) return;
            const prevState = state.state;
            state.state = nextState;
            const snapshot = StateSnapshot.full(video, videoId);
            const summary = LogEvents.summary.stateChange({
                videoId,
                from: prevState,
                to: nextState,
                reason,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                paused: snapshot?.paused,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered,
                lastProgressAgoMs: state.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                progressStreakMs: state.progressStreakMs,
                progressEligible: state.progressEligible,
                pauseFromStall: state.pauseFromStall
            });
            logDebug(summary, {
                from: prevState,
                to: nextState,
                reason,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                paused: snapshot?.paused,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered,
                lastProgressAgoMs: state.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                progressStreakMs: state.progressStreakMs,
                progressEligible: state.progressEligible,
                pauseFromStall: state.pauseFromStall
            });
        };

        const eventHandlers = PlaybackEventHandlers.create({
            video,
            videoId,
            logDebug,
            tracker,
            state,
            setState,
            onReset,
            isActive
        });

        const watchdog = PlaybackWatchdog.create({
            video,
            videoId,
            logDebug,
            tracker,
            state,
            setState,
            isHealing,
            isActive,
            onRemoved,
            onStall
        });

        const start = () => {
            logDebug(LogEvents.tagged('MONITOR', 'PlaybackMonitor started'), {
                state: state.state
            });
            eventHandlers.attach();
            watchdog.start();
        };

        const stop = () => {
            logDebug(LogEvents.tagged('MONITOR', 'PlaybackMonitor stopped'), {
                state: state.state
            });
            watchdog.stop();
            eventHandlers.detach();
        };

        return {
            start,
            stop,
            state
        };
    };

    return { create };
})();

// --- CandidateScorer ---
/**
 * Scores a video candidate based on playback state.
 */
const CandidateScorer = (() => {
    const create = (options) => {
        const minProgressMs = options.minProgressMs;
        const isFallbackSource = options.isFallbackSource;

        const score = (video, monitor, videoId) => {
            const vs = VideoState.getLite(video, videoId);
            const state = monitor.state;
            const progressAgoMs = state.hasProgress && state.lastProgressTime
                ? Date.now() - state.lastProgressTime
                : null;
            const progressStreakMs = state.progressStreakMs || 0;
            const progressEligible = state.progressEligible
                || progressStreakMs >= minProgressMs;
            let score = 0;
            const reasons = [];

            if (!document.contains(video)) {
                score -= 10;
                reasons.push('not_in_dom');
            }

            if (vs.ended) {
                score -= 5;
                reasons.push('ended');
            }

            if (vs.errorCode) {
                score -= 3;
                reasons.push('error');
            }

            if (state.state === 'RESET') {
                score -= 3;
                reasons.push('reset');
            }

            if (state.resetPendingAt) {
                score -= 3;
                reasons.push('reset_pending');
            }

            if (state.state === 'ERROR') {
                score -= 2;
                reasons.push('error_state');
            }

            if (isFallbackSource(vs.currentSrc)) {
                score -= 4;
                reasons.push('fallback_src');
            }

            if (!vs.paused) {
                score += 2;
                reasons.push('playing');
            } else {
                score -= 1;
                reasons.push('paused');
            }

            if (vs.readyState >= 3) {
                score += 2;
                reasons.push('ready_high');
            } else if (vs.readyState >= 2) {
                score += 1;
                reasons.push('ready_mid');
            } else {
                score -= 1;
                reasons.push('ready_low');
            }

            if (progressAgoMs === null) {
                score -= 2;
                reasons.push('no_progress');
            } else if (progressAgoMs < CONFIG.monitoring.PROGRESS_RECENT_MS) {
                score += 3;
                reasons.push('recent_progress');
            } else if (progressAgoMs < CONFIG.monitoring.PROGRESS_STALE_MS) {
                score += 1;
                reasons.push('stale_progress');
            } else {
                score -= 1;
                reasons.push('no_progress');
            }

            if (!progressEligible) {
                score -= 3;
                reasons.push('progress_short');
            }

            if (vs.bufferedLength > 0) {
                score += 1;
                reasons.push('buffered');
            }

            const timeValue = Number.parseFloat(vs.currentTime);
            if (!Number.isNaN(timeValue) && timeValue > 0) {
                score += 1;
                reasons.push('time_nonzero');
            }

            return {
                score,
                reasons,
                vs,
                progressAgoMs,
                progressStreakMs,
                progressEligible
            };
        };

        return { score };
    };

    return { create };
})();

// --- CandidateSwitchPolicy ---
/**
 * Determines whether switching candidates should be allowed.
 */
const CandidateSwitchPolicy = (() => {
    const create = (options) => {
        const switchDelta = options.switchDelta;
        const minProgressMs = options.minProgressMs;
        const logDebug = options.logDebug || (() => {});

        const shouldSwitch = (current, best, scores, reason) => {
            if (!current) {
                return { allow: true };
            }

            const delta = best.score - current.score;
            const currentScore = current.score;
            const currentBad = current.reasons.includes('fallback_src')
                || current.reasons.includes('ended')
                || current.reasons.includes('not_in_dom')
                || current.reasons.includes('reset')
                || current.reasons.includes('error_state');
            let suppression = null;
            let allow = true;

            if (!best.progressEligible && !currentBad) {
                allow = false;
                suppression = 'insufficient_progress';
            } else if (!currentBad && delta < switchDelta) {
                allow = false;
                suppression = 'score_delta';
            }

            if (!allow) {
                logDebug(LogEvents.tagged('CANDIDATE', 'Switch suppressed'), {
                    from: current.id,
                    to: best.id,
                    reason,
                    suppression,
                    delta,
                    currentScore,
                    bestScore: best.score,
                    bestProgressStreakMs: best.progressStreakMs,
                    minProgressMs,
                    scores
                });
            }

            return {
                allow,
                delta,
                currentScore,
                suppression
            };
        };

        return { shouldSwitch };
    };

    return { create };
})();

// --- CandidateTrust ---
/**
 * Determines whether a candidate is trusted for switching/failover.
 */
const CandidateTrust = (() => {
    const BAD_REASONS = ['fallback_src', 'ended', 'not_in_dom', 'reset', 'reset_pending', 'error_state', 'error'];

    const getTrustInfo = (result) => {
        if (!result || !result.progressEligible) {
            return { trusted: false, reason: 'progress_ineligible' };
        }
        const reasons = Array.isArray(result.reasons) ? result.reasons : [];
        if (BAD_REASONS.some(reason => reasons.includes(reason))) {
            return { trusted: false, reason: 'bad_reason' };
        }
        const progressAgoMs = Number.isFinite(result.progressAgoMs)
            ? result.progressAgoMs
            : null;
        if (progressAgoMs === null || progressAgoMs > CONFIG.monitoring.TRUST_STALE_MS) {
            return { trusted: false, reason: 'progress_stale' };
        }
        return { trusted: true, reason: 'trusted' };
    };

    const isTrusted = (result) => getTrustInfo(result).trusted;

    return {
        isTrusted,
        getTrustInfo
    };
})();

// --- CandidateSelector ---
/**
 * Scores and selects the best video candidate for healing.
 */
const CandidateSelector = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const logDebug = options.logDebug;
        const maxMonitors = options.maxMonitors;
        const minProgressMs = options.minProgressMs;
        const switchDelta = options.switchDelta;
        const isFallbackSource = options.isFallbackSource;

        let activeCandidateId = null;
        let lockChecker = null;
        let lastGoodCandidateId = null;
        let probationUntil = 0;
        let probationReason = null;
        let lastDecisionLogTime = 0;
        let suppressionSummary = {
            lastLogTime: Date.now(),
            counts: {},
            lastSample: null
        };
        const scorer = CandidateScorer.create({ minProgressMs, isFallbackSource });
        const switchPolicy = CandidateSwitchPolicy.create({
            switchDelta,
            minProgressMs,
            logDebug
        });

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const activateProbation = (reason) => {
            const windowMs = CONFIG.monitoring.PROBATION_WINDOW_MS;
            probationUntil = Date.now() + windowMs;
            probationReason = reason || 'unknown';
            Logger.add(LogEvents.tagged('PROBATION', 'Window started'), {
                reason: probationReason,
                windowMs
            });
        };

        const isProbationActive = () => {
            if (!probationUntil) return false;
            if (Date.now() <= probationUntil) {
                return true;
            }
            Logger.add(LogEvents.tagged('PROBATION', 'Window ended'), {
                reason: probationReason
            });
            probationUntil = 0;
            probationReason = null;
            return false;
        };

        const shouldLogDecision = (reason) => (
            reason !== 'interval'
            || (Date.now() - lastDecisionLogTime) >= CONFIG.logging.ACTIVE_LOG_MS
        );

        const logDecision = (detail) => {
            if (!detail || !shouldLogDecision(detail.reason)) return;
            lastDecisionLogTime = Date.now();
            Logger.add(LogEvents.tagged('CANDIDATE_DECISION', 'Selection summary'), detail);
        };

        const logSuppression = (detail) => {
            if (!detail) return;
            if (detail.reason !== 'interval') {
                logDebug(LogEvents.tagged('CANDIDATE', 'Switch suppressed'), detail);
                return;
            }
            const cause = detail.cause || 'unknown';
            suppressionSummary.counts[cause] = (suppressionSummary.counts[cause] || 0) + 1;
            suppressionSummary.lastSample = {
                from: detail.from,
                to: detail.to,
                cause,
                reason: detail.reason,
                activeState: detail.activeState,
                probationActive: detail.probationActive
            };

            const now = Date.now();
            const windowMs = now - suppressionSummary.lastLogTime;
            if (windowMs < CONFIG.logging.SUPPRESSION_LOG_MS) {
                return;
            }
            const total = Object.values(suppressionSummary.counts)
                .reduce((sum, count) => sum + count, 0);
            if (total > 0) {
                Logger.add(LogEvents.tagged('SUPPRESSION', 'Switch suppressed summary'), {
                    windowMs,
                    total,
                    byCause: suppressionSummary.counts,
                    lastSample: suppressionSummary.lastSample
                });
            }
            suppressionSummary = {
                lastLogTime: now,
                counts: {},
                lastSample: null
            };
        };

        const getActiveId = () => {
            if (!activeCandidateId && monitorsById.size > 0) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : monitorsById.keys().next().value;
                if (fallbackId) {
                    activeCandidateId = fallbackId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                        to: activeCandidateId,
                        reason: 'fallback'
                    });
                }
            }
            return activeCandidateId;
        };
        const setActiveId = (id) => {
            activeCandidateId = id;
        };

        const scoreVideo = (video, monitor, videoId) => scorer.score(video, monitor, videoId);
        const evaluateCandidates = (reason) => {
            const now = Date.now();
            if (lockChecker && lockChecker()) {
                logDebug(LogEvents.tagged('CANDIDATE', 'Failover lock active'), {
                    reason,
                    activeVideoId: activeCandidateId
                });
                return activeCandidateId ? { id: activeCandidateId } : null;
            }

            if (monitorsById.size === 0) {
                activeCandidateId = null;
                lastGoodCandidateId = null;
                return null;
            }

            let best = null;
            let current = null;
            let bestTrusted = null;
            const scores = [];

            if (activeCandidateId && monitorsById.has(activeCandidateId)) {
                const entry = monitorsById.get(activeCandidateId);
                const result = scoreVideo(entry.video, entry.monitor, activeCandidateId);
                const trustInfo = CandidateTrust.getTrustInfo(result);
                current = {
                    id: activeCandidateId,
                    state: entry.monitor.state.state,
                    monitorState: entry.monitor.state,
                    ...result
                };
                current.trusted = trustInfo.trusted;
                current.trustReason = trustInfo.reason;
            }

            for (const [videoId, entry] of monitorsById.entries()) {
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                const trustInfo = CandidateTrust.getTrustInfo(result);
                const trusted = trustInfo.trusted;
                scores.push({
                    id: videoId,
                    score: result.score,
                    progressAgoMs: result.progressAgoMs,
                    progressStreakMs: result.progressStreakMs,
                    progressEligible: result.progressEligible,
                    paused: result.vs.paused,
                    readyState: result.vs.readyState,
                    hasSrc: Boolean(result.vs.currentSrc),
                    state: entry.monitor.state.state,
                    reasons: result.reasons,
                    trusted,
                    trustReason: trustInfo.reason
                });

                if (!best || result.score > best.score) {
                    best = { id: videoId, ...result, trusted };
                }
                if (trusted && (!bestTrusted || result.score > bestTrusted.score)) {
                    bestTrusted = { id: videoId, ...result, trusted };
                }
            }

            if (bestTrusted) {
                lastGoodCandidateId = bestTrusted.id;
            } else if (lastGoodCandidateId && !monitorsById.has(lastGoodCandidateId)) {
                lastGoodCandidateId = null;
            }

            const preferred = bestTrusted || best;

            if (!activeCandidateId || !monitorsById.has(activeCandidateId)) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : preferred?.id;
                if (fallbackId) {
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                        to: fallbackId,
                        reason: 'no_active',
                        scores
                    });
                    activeCandidateId = fallbackId;
                }
            }

            if (preferred && preferred.id !== activeCandidateId) {
                const activeState = current ? current.state : null;
                const activeMonitorState = current ? current.monitorState : null;
                const activeNoHealPoints = activeMonitorState?.noHealPointCount || 0;
                const activeStalledForMs = activeMonitorState?.lastProgressTime
                    ? (now - activeMonitorState.lastProgressTime)
                    : null;
                const activeHealing = activeState === 'HEALING';
                const activeIsStalled = !current || ['STALLED', 'RESET', 'ERROR', 'ENDED'].includes(activeState);
                const probationActive = isProbationActive();
                const probationProgressOk = preferred.progressStreakMs >= CONFIG.monitoring.PROBATION_MIN_PROGRESS_MS;
                const probationReady = probationActive
                    && probationProgressOk
                    && (preferred.vs.readyState >= CONFIG.monitoring.PROBATION_READY_STATE
                        || preferred.vs.currentSrc);

                const fastSwitchAllowed = activeHealing
                    && preferred.trusted
                    && preferred.progressEligible
                    && preferred.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS
                    && (activeNoHealPoints >= CONFIG.stall.FAST_SWITCH_AFTER_NO_HEAL_POINTS
                        || (activeStalledForMs !== null && activeStalledForMs >= CONFIG.stall.FAST_SWITCH_AFTER_STALL_MS));

                if (fastSwitchAllowed) {
                    const fromId = activeCandidateId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Fast switch from healing dead-end'), {
                        from: fromId,
                        to: preferred.id,
                        reason,
                        activeState,
                        noHealPointCount: activeNoHealPoints,
                        stalledForMs: activeStalledForMs,
                        preferredScore: preferred.score,
                        preferredProgressStreakMs: preferred.progressStreakMs,
                        preferredTrusted: preferred.trusted
                    });
                    activeCandidateId = preferred.id;
                    logDecision({
                        reason,
                        action: 'fast_switch',
                        from: fromId,
                        to: activeCandidateId,
                        activeState,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (!preferred.progressEligible && !probationReady) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'preferred_not_progress_eligible',
                        activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'preferred_not_progress_eligible',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive,
                        probationReady
                    });
                    return preferred;
                }

                if (!activeIsStalled) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'active_not_stalled',
                        activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'active_not_stalled',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                const currentTrusted = current ? current.trusted : false;
                if (currentTrusted && !preferred.trusted) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'trusted_active_blocks_untrusted',
                        activeState,
                        probationActive,
                        currentTrusted,
                        preferredTrusted: preferred.trusted,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'trusted_active_blocks_untrusted',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (!preferred.trusted && !probationActive) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'untrusted_outside_probation',
                        activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'untrusted_outside_probation',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                const preferredForPolicy = probationReady
                    ? { ...preferred, progressEligible: true }
                    : preferred;
                const decision = switchPolicy.shouldSwitch(current, preferredForPolicy, scores, reason);
                if (decision.allow) {
                    const fromId = activeCandidateId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video switched'), {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        delta: decision.delta,
                        currentScore: decision.currentScore,
                        bestScore: preferred.score,
                        bestProgressStreakMs: preferred.progressStreakMs,
                        bestProgressEligible: preferred.progressEligible,
                        probationActive,
                        scores
                    });
                    activeCandidateId = preferred.id;
                    logDecision({
                        reason,
                        action: 'switch',
                        from: fromId,
                        to: activeCandidateId,
                        activeState,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                } else {
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression || 'score_delta',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                }
            }

            return preferred;
        };

        const pruneMonitors = (excludeId, stopMonitoring) => {
            if (monitorsById.size <= maxMonitors) return;

            const protectedIds = new Set();
            if (activeCandidateId) protectedIds.add(activeCandidateId);
            if (lastGoodCandidateId) protectedIds.add(lastGoodCandidateId);

            let worst = null;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                if (protectedIds.has(videoId)) continue;
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                if (!worst || result.score < worst.score) {
                    worst = { id: videoId, entry, score: result.score };
                }
            }

            if (worst) {
                Logger.add(LogEvents.tagged('PRUNE', 'Stopped monitor due to cap'), {
                    videoId: worst.id,
                    score: worst.score,
                    maxMonitors
                });
                stopMonitoring(worst.entry.video);
            } else {
                logDebug(LogEvents.tagged('PRUNE_SKIP', 'All candidates protected'), {
                    protected: Array.from(protectedIds),
                    maxMonitors,
                    totalMonitors: monitorsById.size
                });
            }
        };

        return {
            evaluateCandidates,
            pruneMonitors,
            scoreVideo,
            getActiveId,
            setActiveId,
            setLockChecker,
            activateProbation,
            isProbationActive
        };
    };

    return { create };
})();

// --- BackoffManager ---
/**
 * Tracks stall backoff state for no-heal-point scenarios.
 */
const BackoffManager = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});

        const resetBackoff = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.noHealPointCount > 0 || monitorState.nextHealAllowedTime > 0) {
                logDebug(LogEvents.tagged('BACKOFF', 'Reset'), {
                    reason,
                    previousNoHealPoints: monitorState.noHealPointCount,
                    previousNextHealAllowedMs: monitorState.nextHealAllowedTime
                        ? Math.max(monitorState.nextHealAllowedTime - Date.now(), 0)
                        : 0
                });
            }
            monitorState.noHealPointCount = 0;
            monitorState.nextHealAllowedTime = 0;
        };

        const applyBackoff = (videoId, monitorState, reason) => {
            if (!monitorState) return;
            const count = (monitorState.noHealPointCount || 0) + 1;
            const base = CONFIG.stall.NO_HEAL_POINT_BACKOFF_BASE_MS;
            const max = CONFIG.stall.NO_HEAL_POINT_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.noHealPointCount = count;
            monitorState.nextHealAllowedTime = Date.now() + backoffMs;

            Logger.add(LogEvents.tagged('BACKOFF', 'No heal point'), {
                videoId,
                reason,
                noHealPointCount: count,
                backoffMs,
                nextHealAllowedInMs: backoffMs
            });
        };

        const shouldSkip = (videoId, monitorState) => {
            const now = Date.now();
            if (monitorState?.nextHealAllowedTime && now < monitorState.nextHealAllowedTime) {
                if (now - (monitorState.lastBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastBackoffLogTime = now;
                    logDebug(LogEvents.tagged('BACKOFF', 'Stall skipped due to backoff'), {
                        videoId,
                        remainingMs: monitorState.nextHealAllowedTime - now,
                        noHealPointCount: monitorState.noHealPointCount
                    });
                }
                return true;
            }
            return false;
        };

        return {
            resetBackoff,
            applyBackoff,
            shouldSkip
        };
    };

    return { create };
})();

// --- RecoveryPolicy ---
/**
 * Centralized recovery/backoff policy logic.
 */
const RecoveryPolicy = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const candidateSelector = options.candidateSelector;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;

        const backoffManager = BackoffManager.create({ logDebug });
        let lastProbationRescanAt = 0;
        const noBufferRescanTimes = new Map();

        const maybeTriggerProbation = (videoId, monitorState, trigger, count, threshold) => {
            if (!monitorState) return false;
            if (count < threshold) {
                return false;
            }
            const now = Date.now();
            if (now - lastProbationRescanAt < CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                return false;
            }
            lastProbationRescanAt = now;
            const reason = trigger || 'probation';
            if (candidateSelector) {
                candidateSelector.activateProbation(reason);
            }
            onRescan(reason, {
                videoId,
                count,
                trigger: reason
            });
            return true;
        };

        const maybeTriggerRefresh = (videoId, monitorState, reason) => {
            if (!monitorState) return false;
            const now = Date.now();
            if ((monitorState.noHealPointCount || 0) < CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                return false;
            }
            const nextAllowed = monitorState.lastRefreshAt
                ? (monitorState.lastRefreshAt + CONFIG.stall.REFRESH_COOLDOWN_MS)
                : 0;
            if (now < nextAllowed) {
                return false;
            }
            monitorState.lastRefreshAt = now;
            logDebug(LogEvents.tagged('REFRESH', 'Refreshing video after repeated no-heal points'), {
                videoId,
                reason,
                noHealPointCount: monitorState.noHealPointCount
            });
            monitorState.noHealPointCount = 0;
            onPersistentFailure(videoId, {
                reason,
                detail: 'no_heal_point'
            });
            return true;
        };

        const handleNoHealPoint = (context, reason) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');

            backoffManager.applyBackoff(videoId, monitorState, reason);

            const ranges = MediaState.ranges(video);
            if (!ranges.length) {
                const now = Date.now();
                const lastNoBufferRescan = noBufferRescanTimes.get(videoId) || 0;
                if (now - lastNoBufferRescan >= CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                    noBufferRescanTimes.set(videoId, now);
                    if (candidateSelector) {
                        candidateSelector.activateProbation('no_buffer');
                    }
                    onRescan('no_buffer', {
                        videoId,
                        reason,
                        bufferRanges: 'none'
                    });
                }
            }

            const probationTriggered = maybeTriggerProbation(
                videoId,
                monitorState,
                reason,
                monitorState?.noHealPointCount || 0,
                CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS
            );

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById && monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            const refreshed = maybeTriggerRefresh(videoId, monitorState, reason);

            return {
                shouldFailover,
                refreshed,
                probationTriggered
            };
        };

        const resetPlayError = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.playErrorCount > 0 || monitorState.nextPlayHealAllowedTime > 0) {
                logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Reset'), {
                    reason,
                    previousPlayErrors: monitorState.playErrorCount,
                    previousNextPlayAllowedMs: monitorState.nextPlayHealAllowedTime
                        ? Math.max(monitorState.nextPlayHealAllowedTime - Date.now(), 0)
                        : 0,
                    previousHealPointRepeats: monitorState.healPointRepeatCount
                });
            }
            monitorState.playErrorCount = 0;
            monitorState.nextPlayHealAllowedTime = 0;
            monitorState.lastPlayErrorTime = 0;
            monitorState.lastPlayBackoffLogTime = 0;
            monitorState.lastHealPointKey = null;
            monitorState.healPointRepeatCount = 0;
        };

        const handlePlayFailure = (context, detail = {}) => {
            const video = context.video;
            const monitorState = context.monitorState;
            if (!monitorState) return { shouldFailover: false, probationTriggered: false, repeatStuck: false };
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');
            const now = Date.now();
            const lastErrorTime = monitorState.lastPlayErrorTime || 0;
            if (lastErrorTime > 0 && (now - lastErrorTime) > CONFIG.stall.PLAY_ERROR_DECAY_MS) {
                monitorState.playErrorCount = 0;
            }

            const count = (monitorState.playErrorCount || 0) + 1;
            const isAbortError = detail?.errorName === 'AbortError'
                || (typeof detail?.error === 'string' && detail.error.toLowerCase().includes('aborted'));
            const base = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_BASE_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS;
            const max = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_MAX_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.playErrorCount = count;
            monitorState.lastPlayErrorTime = now;
            monitorState.nextPlayHealAllowedTime = now + backoffMs;

            Logger.add(LogEvents.tagged('PLAY_BACKOFF', 'Play failed'), {
                videoId,
                reason: detail.reason,
                error: detail.error,
                errorName: detail.errorName,
                playErrorCount: count,
                backoffMs,
                abortBackoff: isAbortError,
                nextHealAllowedInMs: backoffMs,
                healRange: detail.healRange || null,
                healPointRepeatCount: detail.healPointRepeatCount || 0
            });

            const repeatCount = detail.healPointRepeatCount || 0;
            const repeatStuck = repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT;
            if (repeatStuck) {
                Logger.add(LogEvents.tagged('HEALPOINT_STUCK', 'Repeated heal point loop'), {
                    videoId,
                    healRange: detail.healRange || null,
                    repeatCount,
                    errorName: detail.errorName,
                    error: detail.error
                });
            }

            const probationTriggered = maybeTriggerProbation(
                videoId,
                monitorState,
                detail.reason || 'play_error',
                count,
                CONFIG.stall.PROBATION_AFTER_PLAY_ERRORS
            );

            if (repeatStuck && !probationTriggered) {
                const nowMs = Date.now();
                if (nowMs - lastProbationRescanAt >= CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                    lastProbationRescanAt = nowMs;
                    if (candidateSelector) {
                        candidateSelector.activateProbation('healpoint_stuck');
                    }
                    onRescan('healpoint_stuck', {
                        videoId,
                        count: repeatCount,
                        trigger: 'healpoint_stuck'
                    });
                }
            }

            const shouldFailover = monitorsById && monitorsById.size > 1
                && (count >= CONFIG.stall.FAILOVER_AFTER_PLAY_ERRORS || repeatStuck);

            return {
                shouldFailover,
                probationTriggered,
                repeatStuck
            };
        };

        const shouldSkipStall = (context) => {
            const videoId = context.videoId;
            const monitorState = context.monitorState;
            const now = Date.now();
            if (backoffManager.shouldSkip(videoId, monitorState)) {
                return true;
            }
            if (monitorState?.bufferStarveUntil && now < monitorState.bufferStarveUntil) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug(LogEvents.tagged('STARVE_SKIP', 'Stall skipped due to buffer starvation'), {
                        videoId,
                        remainingMs: monitorState.bufferStarveUntil - now,
                        bufferAhead: monitorState.lastBufferAhead !== null
                            ? monitorState.lastBufferAhead.toFixed(3)
                            : null
                    });
                }
                return true;
            }
            if (monitorState?.nextPlayHealAllowedTime && now < monitorState.nextPlayHealAllowedTime) {
                if (now - (monitorState.lastPlayBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastPlayBackoffLogTime = now;
                    logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Stall skipped due to play backoff'), {
                        videoId,
                        remainingMs: monitorState.nextPlayHealAllowedTime - now,
                        playErrorCount: monitorState.playErrorCount
                    });
                }
                return true;
            }

            if (monitorState) {
                const lastProgress = monitorState.lastProgressTime || 0;
                const stalledForMs = lastProgress ? (now - lastProgress) : null;
                const baseGraceMs = CONFIG.stall.SELF_RECOVER_GRACE_MS;
                const allowExtraGrace = !monitorState.bufferStarved;
                const extraGraceMs = allowExtraGrace ? (CONFIG.stall.SELF_RECOVER_EXTRA_MS || 0) : 0;
                const maxGraceMs = CONFIG.stall.SELF_RECOVER_MAX_MS || 0;
                const extendedGraceMs = maxGraceMs
                    ? Math.min(baseGraceMs + extraGraceMs, maxGraceMs)
                    : baseGraceMs + extraGraceMs;
                const maxMs = CONFIG.stall.SELF_RECOVER_MAX_MS;

                if (stalledForMs !== null && (!maxMs || stalledForMs <= maxMs)) {
                    const signals = [];
                    const strongSignals = [];
                    const lastSrcChange = monitorState.lastSrcChangeTime || 0;
                    const lastReadyChange = monitorState.lastReadyStateChangeTime || 0;
                    const lastNetworkChange = monitorState.lastNetworkStateChangeTime || 0;
                    const lastBufferRangeChange = monitorState.lastBufferedLengthChangeTime || 0;
                    const lastBufferGrow = monitorState.lastBufferAheadIncreaseTime || 0;

                    const isWithin = (ts, windowMs) => (
                        ts > lastProgress && (now - ts) <= windowMs
                    );

                    if (isWithin(lastReadyChange, extendedGraceMs)) {
                        signals.push('ready_state');
                        strongSignals.push('ready_state');
                    }
                    if (isWithin(lastBufferGrow, extendedGraceMs)) {
                        signals.push('buffer_growth');
                        strongSignals.push('buffer_growth');
                    }
                    if (isWithin(lastSrcChange, baseGraceMs)) {
                        signals.push('src_change');
                    }
                    if (isWithin(lastNetworkChange, baseGraceMs)) {
                        signals.push('network_state');
                    }
                    if (isWithin(lastBufferRangeChange, baseGraceMs)) {
                        signals.push('buffer_ranges');
                    }

                    if (signals.length > 0) {
                        const graceMs = strongSignals.length > 0 ? extendedGraceMs : baseGraceMs;
                        if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                            monitorState.lastSelfRecoverSkipLogTime = now;
                            logDebug(LogEvents.tagged('SELF_RECOVER_SKIP', 'Stall skipped for self-recovery window'), {
                                videoId,
                                stalledForMs,
                                graceMs,
                                extraGraceMs: strongSignals.length > 0 ? extraGraceMs : 0,
                                signals,
                                bufferAhead: monitorState.lastBufferAhead,
                                bufferStarved: monitorState.bufferStarved || false
                            });
                        }
                        return true;
                    }
                }
            }

            return false;
        };

        return {
            resetBackoff: backoffManager.resetBackoff,
            resetPlayError,
            handleNoHealPoint,
            handlePlayFailure,
            shouldSkipStall
        };
    };

    return { create };
})();

// --- FailoverCandidatePicker ---
/**
 * Chooses a failover candidate from monitored videos.
 */
const FailoverCandidatePicker = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const scoreVideo = options.scoreVideo;

        const getVideoIndex = (videoId) => {
            const match = /video-(\d+)/.exec(videoId);
            return match ? Number(match[1]) : -1;
        };

        const selectPreferred = (excludeId, excludeIds = null) => {
            const excluded = excludeIds instanceof Set ? excludeIds : new Set();
            if (typeof scoreVideo === 'function') {
                let best = null;
                let bestTrusted = null;
                for (const [videoId, entry] of monitorsById.entries()) {
                    if (videoId === excludeId || excluded.has(videoId)) continue;
                    const result = scoreVideo(entry.video, entry.monitor, videoId);
                    const candidate = { id: videoId, entry, score: result.score, result };

                    if (!best || result.score > best.score) {
                        best = candidate;
                    }
                    if (CandidateTrust.isTrusted(result) && (!bestTrusted || result.score > bestTrusted.score)) {
                        bestTrusted = candidate;
                    }
                }
                return bestTrusted || null;
            }

            let newest = null;
            let newestIndex = -1;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId || excluded.has(videoId)) continue;
                const idx = getVideoIndex(videoId);
                if (idx > newestIndex) {
                    newestIndex = idx;
                    newest = { id: videoId, entry };
                }
            }
            return newest;
        };

        return { selectPreferred };
    };

    return { create };
})();

// --- FailoverManager ---
/**
 * Handles candidate failover attempts when healing fails.
 */
const FailoverManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;
        const resetBackoff = options.resetBackoff || (() => {});
        const picker = FailoverCandidatePicker.create({
            monitorsById,
            scoreVideo: candidateSelector?.scoreVideo
        });

        const state = {
            inProgress: false,
            timerId: null,
            lastAttemptTime: 0,
            fromId: null,
            toId: null,
            startTime: 0,
            baselineProgressTime: 0,
            recentFailures: new Map(),
            lastProbeTimes: new Map(),
            probeStats: new Map()
        };

        const resetFailover = (reason) => {
            if (state.timerId) {
                clearTimeout(state.timerId);
            }
            if (state.inProgress) {
                Logger.add(LogEvents.tagged('FAILOVER', 'Cleared'), {
                    reason,
                    from: state.fromId,
                    to: state.toId
                });
            }
            state.inProgress = false;
            state.timerId = null;
            state.fromId = null;
            state.toId = null;
            state.startTime = 0;
            state.baselineProgressTime = 0;
        };

        const attemptFailover = (fromVideoId, reason, monitorState) => {
            const now = Date.now();
            if (state.inProgress) {
                logDebug(LogEvents.tagged('FAILOVER_SKIP', 'Failover already in progress'), {
                    from: fromVideoId,
                    reason
                });
                return false;
            }
            if (now - state.lastAttemptTime < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
                logDebug(LogEvents.tagged('FAILOVER_SKIP', 'Failover cooldown active'), {
                    from: fromVideoId,
                    reason,
                    cooldownMs: CONFIG.stall.FAILOVER_COOLDOWN_MS,
                    lastAttemptAgoMs: now - state.lastAttemptTime
                });
                return false;
            }

            const excluded = new Set();
            for (const [videoId, failedAt] of state.recentFailures.entries()) {
                if (now - failedAt < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
                    excluded.add(videoId);
                } else {
                    state.recentFailures.delete(videoId);
                }
            }

            const candidate = picker.selectPreferred(fromVideoId, excluded);
            if (!candidate) {
                Logger.add(LogEvents.tagged('FAILOVER_SKIP', 'No trusted candidate available'), {
                    from: fromVideoId,
                    reason,
                    excluded: Array.from(excluded)
                });
                return false;
            }

            const toId = candidate.id;
            const entry = candidate.entry;

            state.inProgress = true;
            state.lastAttemptTime = now;
            state.fromId = fromVideoId;
            state.toId = toId;
            state.startTime = now;
            state.baselineProgressTime = entry.monitor.state.lastProgressTime || 0;

            candidateSelector.setActiveId(toId);

            Logger.add(LogEvents.tagged('FAILOVER', 'Switching to candidate'), {
                from: fromVideoId,
                to: toId,
                reason,
                stalledForMs: monitorState?.lastProgressTime ? (now - monitorState.lastProgressTime) : null,
                candidateState: VideoState.get(entry.video, toId)
            });

            const playPromise = entry.video?.play?.();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    Logger.add(LogEvents.tagged('FAILOVER_PLAY', 'Play rejected'), {
                        to: toId,
                        error: err?.name,
                        message: err?.message
                    });
                });
            }

            state.timerId = setTimeout(() => {
                if (!state.inProgress || state.toId !== toId) {
                    return;
                }

                const currentEntry = monitorsById.get(toId);
                const fromEntry = monitorsById.get(fromVideoId);
                const latestProgressTime = currentEntry?.monitor.state.lastProgressTime || 0;
                const progressed = currentEntry
                    && currentEntry.monitor.state.hasProgress
                    && latestProgressTime > state.baselineProgressTime
                    && latestProgressTime >= state.startTime;

                if (progressed) {
                    Logger.add(LogEvents.tagged('FAILOVER_SUCCESS', 'Candidate progressed'), {
                        from: fromVideoId,
                        to: toId,
                        progressDelayMs: latestProgressTime - state.startTime,
                        candidateState: VideoState.get(currentEntry.video, toId)
                    });
                    resetBackoff(currentEntry.monitor.state, 'failover_success');
                    state.recentFailures.delete(toId);
                } else {
                    Logger.add(LogEvents.tagged('FAILOVER_REVERT', 'Candidate did not progress'), {
                        from: fromVideoId,
                        to: toId,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS,
                        progressObserved: Boolean(currentEntry?.monitor.state.hasProgress),
                        candidateState: currentEntry ? VideoState.get(currentEntry.video, toId) : null
                    });
                    state.recentFailures.set(toId, Date.now());
                    if (fromEntry) {
                        candidateSelector.setActiveId(fromVideoId);
                    }
                }

                resetFailover('timeout');
            }, CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS);

            return true;
        };

        const shouldIgnoreStall = (videoId) => {
            if (state.inProgress && state.toId === videoId) {
                const elapsedMs = Date.now() - state.startTime;
                if (elapsedMs < CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS) {
                    logDebug(LogEvents.tagged('FAILOVER', 'Stall ignored during failover'), {
                        videoId,
                        elapsedMs,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS
                    });
                    return true;
                }
            }
            return false;
        };

        const onMonitorRemoved = (videoId) => {
            if (state.inProgress && (videoId === state.toId || videoId === state.fromId)) {
                resetFailover('monitor_removed');
            }
        };

        const getProbeStats = (videoId) => {
            let stats = state.probeStats.get(videoId);
            if (!stats) {
                stats = {
                    lastSummaryTime: 0,
                    counts: {
                        attempt: 0,
                        skipCooldown: 0,
                        skipNotReady: 0,
                        skipNotInDom: 0,
                        playRejected: 0
                    },
                    reasons: {},
                    lastError: null,
                    lastState: null,
                    lastReadyState: null,
                    lastHasSrc: null
                };
                state.probeStats.set(videoId, stats);
            }
            return stats;
        };

        const noteProbeReason = (stats, reason) => {
            if (!reason) return;
            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        };

        const maybeLogProbeSummary = (videoId, stats) => {
            const now = Date.now();
            const intervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
            if (now - stats.lastSummaryTime < intervalMs) {
                return;
            }

            const totalCount = Object.values(stats.counts).reduce((sum, value) => sum + value, 0);
            if (totalCount === 0) {
                stats.lastSummaryTime = now;
                return;
            }

            Logger.add(LogEvents.tagged('PROBE_SUMMARY', 'Probe activity'), {
                videoId,
                intervalMs,
                counts: stats.counts,
                reasons: stats.reasons,
                lastState: stats.lastState,
                lastReadyState: stats.lastReadyState,
                lastHasSrc: stats.lastHasSrc,
                lastError: stats.lastError
            });

            stats.lastSummaryTime = now;
            stats.counts = {
                attempt: 0,
                skipCooldown: 0,
                skipNotReady: 0,
                skipNotInDom: 0,
                playRejected: 0
            };
            stats.reasons = {};
            stats.lastError = null;
        };

        return {
            isActive: () => state.inProgress,
            resetFailover,
            attemptFailover,
            probeCandidate: (videoId, reason) => {
                const entry = monitorsById.get(videoId);
                const stats = getProbeStats(videoId);
                noteProbeReason(stats, reason);
                if (!entry) return false;
                const video = entry.video;
                if (!document.contains(video)) {
                    stats.counts.skipNotInDom += 1;
                    maybeLogProbeSummary(videoId, stats);
                    return false;
                }

                const now = Date.now();
                const cooldownMs = CONFIG.monitoring.PROBE_COOLDOWN_MS;
                const lastProbeTime = state.lastProbeTimes.get(videoId) || 0;
                if (lastProbeTime > 0 && now - lastProbeTime < cooldownMs) {
                    stats.counts.skipCooldown += 1;
                    maybeLogProbeSummary(videoId, stats);
                    return false;
                }

                const currentSrc = video.currentSrc || (video.getAttribute ? (video.getAttribute('src') || '') : '');
                const readyState = video.readyState;
                if (!currentSrc && readyState < 2) {
                    stats.counts.skipNotReady += 1;
                    stats.lastReadyState = readyState;
                    stats.lastHasSrc = Boolean(currentSrc);
                    maybeLogProbeSummary(videoId, stats);
                    return false;
                }

                state.lastProbeTimes.set(videoId, now);
                stats.counts.attempt += 1;
                stats.lastState = entry.monitor.state.state;
                stats.lastReadyState = readyState;
                stats.lastHasSrc = Boolean(currentSrc);
                maybeLogProbeSummary(videoId, stats);
                const promise = video?.play?.();
                if (promise && typeof promise.catch === 'function') {
                    promise.catch((err) => {
                        const innerStats = getProbeStats(videoId);
                        noteProbeReason(innerStats, reason);
                        innerStats.counts.playRejected += 1;
                        innerStats.lastError = {
                            error: err?.name,
                            message: err?.message
                        };
                        maybeLogProbeSummary(videoId, innerStats);
                    });
                }
                return true;
            },
            shouldIgnoreStall,
            onMonitorRemoved
        };
    };

    return { create };
})();

// --- RecoveryManager ---
/**
 * Coordinates backoff and failover recovery strategies.
 */
const RecoveryManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});

        const policy = RecoveryPolicy.create({
            logDebug,
            candidateSelector,
            onRescan,
            onPersistentFailure,
            monitorsById,
            getVideoId
        });
        const failoverManager = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            resetBackoff: policy.resetBackoff
        });
        const probeCandidate = failoverManager.probeCandidate;
        const handleNoHealPoint = (videoOrContext, monitorStateOverride, reason) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, { reason });
            const result = policy.handleNoHealPoint(context, reason);
            if (result.shouldFailover) {
                failoverManager.attemptFailover(context.videoId, reason, context.monitorState);
            }
            if (result.refreshed) {
                return;
            }
        };

        const resetPlayError = policy.resetPlayError;

        const handlePlayFailure = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, detail);
            const result = policy.handlePlayFailure(context, detail);
            const shouldConsider = result.probationTriggered || result.repeatStuck || result.shouldFailover;
            if (!shouldConsider) {
                return;
            }
            const beforeActive = candidateSelector.getActiveId();
            candidateSelector.evaluateCandidates('play_error');
            const afterActive = candidateSelector.getActiveId();
            if (result.shouldFailover && afterActive === beforeActive) {
                failoverManager.attemptFailover(context.videoId, detail.reason || 'play_error', context.monitorState);
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            if (failoverManager.shouldIgnoreStall(videoId)) {
                return true;
            }
            const context = RecoveryContext.create(
                monitorsById?.get(videoId)?.video || null,
                monitorState,
                getVideoId,
                { videoId }
            );
            return policy.shouldSkipStall(context);
        };

        return {
            isFailoverActive: () => failoverManager.isActive(),
            resetFailover: failoverManager.resetFailover,
            resetBackoff: policy.resetBackoff,
            resetPlayError,
            handleNoHealPoint,
            handlePlayFailure,
            shouldSkipStall,
            probeCandidate,
            onMonitorRemoved: failoverManager.onMonitorRemoved
        };
    };

    return { create };
})();

// --- MonitorRegistry ---
/**
 * Tracks monitored videos and coordinates playback monitoring lifecycle.
 */
const MonitorRegistry = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});

        const monitoredVideos = new WeakMap();
        const monitorsById = new Map();
        const videoIds = new WeakMap();
        let nextVideoId = 1;
        let monitoredCount = 0;
        let candidateIntervalId = null;
        let candidateSelector = null;
        let recoveryManager = null;

        const bind = (handlers = {}) => {
            candidateSelector = handlers.candidateSelector || null;
            recoveryManager = handlers.recoveryManager || null;
        };

        const getVideoId = (video) => {
            let id = videoIds.get(video);
            if (!id) {
                id = `video-${nextVideoId++}`;
                videoIds.set(video, id);
            }
            return id;
        };

        const startCandidateEvaluation = () => {
            if (candidateIntervalId || !candidateSelector) return;
            candidateIntervalId = setInterval(() => {
                candidateSelector.evaluateCandidates('interval');
            }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stopCandidateEvaluationIfIdle = () => {
            if (monitorsById.size === 0 && candidateIntervalId) {
                clearInterval(candidateIntervalId);
                candidateIntervalId = null;
                if (candidateSelector) {
                    candidateSelector.setActiveId(null);
                }
            }
        };

        const stopMonitoring = (video) => {
            const monitor = monitoredVideos.get(video);
            if (!monitor) return;

            monitor.stop();
            monitoredVideos.delete(video);
            const videoId = getVideoId(video);
            monitorsById.delete(videoId);
            monitoredCount--;
            if (recoveryManager) {
                recoveryManager.onMonitorRemoved(videoId);
            }
            if (candidateSelector && candidateSelector.getActiveId() === videoId) {
                candidateSelector.setActiveId(null);
                if (monitorsById.size > 0) {
                    candidateSelector.evaluateCandidates('removed');
                }
            }
            stopCandidateEvaluationIfIdle();
            Logger.add(LogEvents.tagged('STOP', 'Stopped monitoring video'), {
                remainingMonitors: monitoredCount,
                videoId
            });
        };

        const resetVideoId = (video) => {
            if (!video) return;
            videoIds.delete(video);
        };

        const monitor = (video) => {
            if (!video) return;

            if (!candidateSelector) {
                logDebug(LogEvents.tagged('SKIP', 'Candidate selector not ready'));
                return;
            }

            if (monitoredVideos.has(video)) {
                logDebug(LogEvents.tagged('SKIP', 'Video already being monitored'));
                return;
            }

            const videoId = getVideoId(video);
            Logger.add(LogEvents.tagged('VIDEO', 'Video registered'), {
                videoId,
                videoState: VideoState.getLog(video, videoId)
            });

            const monitor = PlaybackMonitor.create(video, {
                isHealing,
                isActive: () => candidateSelector.getActiveId() === videoId,
                onRemoved: () => stopMonitoring(video),
                onStall: (details, state) => onStall(video, details, state),
                onReset: (details) => {
                    Logger.add(LogEvents.tagged('RESET', 'Video reset detected'), {
                        videoId,
                        ...details
                    });
                    candidateSelector.evaluateCandidates('reset');
                },
                videoId
            });

            monitor.start();

            monitoredVideos.set(video, monitor);
            monitorsById.set(videoId, { video, monitor });
            monitoredCount++;
            startCandidateEvaluation();
            candidateSelector.pruneMonitors(videoId, stopMonitoring);
            candidateSelector.evaluateCandidates('register');

            Logger.add(LogEvents.tagged('MONITOR', 'Started monitoring video'), {
                videoId,
                debug: CONFIG.debug,
                checkInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                totalMonitors: monitoredCount
            });
        };

        return {
            monitor,
            stopMonitoring,
            resetVideoId,
            getVideoId,
            bind,
            monitorsById,
            getMonitoredCount: () => monitoredCount
        };
    };

    return { create };
})();

// --- MonitorCoordinator ---
/**
 * Coordinates monitor registry and candidate selection lifecycle.
 */
const MonitorCoordinator = (() => {
    const create = (options = {}) => {
        const monitorRegistry = options.monitorRegistry;
        const candidateSelector = options.candidateSelector;
        const logDebug = options.logDebug || (() => {});

        const monitorsById = monitorRegistry.monitorsById;
        const getVideoId = monitorRegistry.getVideoId;

        const scanForVideos = (reason, detail = {}) => {
            if (!document?.querySelectorAll) {
                return;
            }
            const beforeCount = monitorsById.size;
            const videos = Array.from(document.querySelectorAll('video'));
            Logger.add(LogEvents.tagged('SCAN', 'Video rescan requested'), {
                reason,
                found: videos.length,
                ...detail
            });
            for (const video of videos) {
                const videoId = getVideoId(video);
                logDebug(LogEvents.tagged('SCAN_ITEM', 'Video discovered'), {
                    reason,
                    videoId,
                    alreadyMonitored: monitorsById.has(videoId)
                });
            }
            for (const video of videos) {
                monitorRegistry.monitor(video);
            }
            candidateSelector.evaluateCandidates(`scan_${reason || 'manual'}`);
            candidateSelector.getActiveId();
            const afterCount = monitorsById.size;
            Logger.add(LogEvents.tagged('SCAN', 'Video rescan complete'), {
                reason,
                found: videos.length,
                newMonitors: Math.max(afterCount - beforeCount, 0),
                totalMonitors: afterCount
            });
        };

        const refreshVideo = (videoId, detail = {}) => {
            const entry = monitorsById.get(videoId);
            if (!entry) return false;
            const { video } = entry;
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video to escape stale state'), {
                videoId,
                detail
            });
            monitorRegistry.stopMonitoring(video);
            monitorRegistry.resetVideoId(video);
            setTimeout(() => {
                scanForVideos('refresh', {
                    videoId,
                    ...detail
                });
            }, 100);
            return true;
        };

        return {
            monitor: monitorRegistry.monitor,
            stopMonitoring: monitorRegistry.stopMonitoring,
            scanForVideos,
            refreshVideo,
            monitorsById,
            getVideoId,
            getMonitoredCount: () => monitorRegistry.getMonitoredCount()
        };
    };

    return { create };
})();

// --- HealPointPoller ---
/**
 * Polls for heal points and detects self-recovery.
 */
const HealPointPoller = (() => {
    const create = (options) => {
        const getVideoId = options.getVideoId;
        const logWithState = options.logWithState;
        const logDebug = options.logDebug;
        const shouldAbort = options.shouldAbort || (() => false);

        const hasRecovered = (video, monitorState) => {
            if (!video || !monitorState) return false;
            return Date.now() - monitorState.lastProgressTime < CONFIG.stall.RECOVERY_WINDOW_MS;
        };

        const pollForHealPoint = async (video, monitorState, timeoutMs) => {
            const startTime = Date.now();
            let pollCount = 0;
            const videoId = getVideoId(video);

            logWithState(LogEvents.TAG.POLL_START, video, {
                timeout: timeoutMs + 'ms'
            });

            while (Date.now() - startTime < timeoutMs) {
                pollCount++;

                const abortReason = shouldAbort(video, monitorState);
                if (abortReason) {
                    return {
                        healPoint: null,
                        aborted: true,
                        reason: typeof abortReason === 'string' ? abortReason : 'abort'
                    };
                }

                if (hasRecovered(video, monitorState)) {
                    logWithState(LogEvents.TAG.SELF_RECOVERED, video, {
                        pollCount,
                        elapsed: (Date.now() - startTime) + 'ms'
                    });
                    return {
                        healPoint: null,
                        aborted: false
                    };
                }

                const healPoint = BufferGapFinder.findHealPoint(video, { silent: true });

                if (healPoint) {
                    const headroom = healPoint.end - healPoint.start;
                    if (headroom < CONFIG.recovery.MIN_HEAL_HEADROOM_S) {
                        const gapOverrideMin = CONFIG.recovery.GAP_OVERRIDE_MIN_GAP_S || 0;
                        const gapHeadroomMin = CONFIG.recovery.GAP_OVERRIDE_MIN_HEADROOM_S || 0;
                        const gapSize = healPoint.gapSize || 0;
                        const isGap = !healPoint.isNudge && gapSize > 0 && (healPoint.rangeIndex || 0) > 0;
                        const canOverride = isGap && gapSize >= gapOverrideMin && headroom >= gapHeadroomMin;
                        if (canOverride) {
                            Logger.add(LogEvents.tagged('GAP_OVERRIDE', 'Low headroom gap heal allowed'), {
                                bufferHeadroom: headroom.toFixed(2) + 's',
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                overrideMinHeadroom: gapHeadroomMin + 's',
                                gapSize: gapSize.toFixed(2) + 's',
                                minGap: gapOverrideMin + 's',
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                            });
                            return {
                                healPoint,
                                aborted: false
                            };
                        }

                        const now = Date.now();
                        if (monitorState && now - (monitorState.lastHealDeferralLogTime || 0) >= CONFIG.logging.HEAL_DEFER_LOG_MS) {
                            monitorState.lastHealDeferralLogTime = now;
                            const deferSummary = LogEvents.summary.healDefer({
                                bufferHeadroom: headroom,
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S,
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                            });
                            logDebug(deferSummary, {
                                bufferHeadroom: headroom.toFixed(2) + 's',
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                            });
                        }
                        await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
                        continue;
                    }

                    Logger.add(LogEvents.TAG.POLL_SUCCESS, {
                        attempts: pollCount,
                        type: healPoint.isNudge ? 'NUDGE' : 'GAP',
                        elapsed: (Date.now() - startTime) + 'ms',
                        healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        bufferSize: headroom.toFixed(2) + 's'
                    });
                    return {
                        healPoint,
                        aborted: false
                    };
                }

                if (pollCount % 25 === 0) {
                    logDebug(LogEvents.TAG.POLLING, {
                        attempt: pollCount,
                        elapsed: (Date.now() - startTime) + 'ms',
                        buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    });
                }

                await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
            }

            Logger.add(LogEvents.TAG.POLL_TIMEOUT, {
                attempts: pollCount,
                elapsed: (Date.now() - startTime) + 'ms',
                finalState: VideoState.get(video, videoId)
            });

            return {
                healPoint: null,
                aborted: false
            };
        };

        return {
            pollForHealPoint,
            hasRecovered
        };
    };

    return { create };
})();

// --- HealPipeline ---
/**
 * Handles heal-point polling and seek recovery.
 */
const HealPipeline = (() => {
    const create = (options) => {
        const getVideoId = options.getVideoId;
        const logWithState = options.logWithState;
        const recoveryManager = options.recoveryManager;
        const onDetached = options.onDetached || (() => {});
        const poller = HealPointPoller.create({
            getVideoId,
            logWithState,
            logDebug: options.logDebug,
            shouldAbort: (video) => (!document.contains(video) ? 'detached' : false)
        });

        const state = {
            isHealing: false,
            healAttempts: 0
        };

        const getBufferEndDelta = (video) => {
            const ranges = BufferGapFinder.getBufferRanges(video);
            if (!ranges.length) return null;
            const end = ranges[ranges.length - 1].end;
            return end - video.currentTime;
        };

        const scheduleCatchUp = (video, monitorState, videoId, reason) => {
            if (!monitorState || monitorState.catchUpTimeoutId) return;
            monitorState.catchUpAttempts = 0;
            const delayMs = CONFIG.recovery.CATCH_UP_DELAY_MS;
            Logger.add(LogEvents.tagged('CATCH_UP', 'Scheduled'), {
                reason,
                delayMs,
                videoState: VideoState.get(video, videoId)
            });
            monitorState.catchUpTimeoutId = setTimeout(() => {
                attemptCatchUp(video, monitorState, videoId, reason);
            }, delayMs);
        };

        const attemptCatchUp = (video, monitorState, videoId, reason) => {
            if (!monitorState) return;
            monitorState.catchUpTimeoutId = null;
            monitorState.catchUpAttempts += 1;

            if (!document.contains(video)) {
                    Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (detached)'), {
                        reason,
                        attempts: monitorState.catchUpAttempts
                    });
                return;
            }

            const now = Date.now();
            const stallAgoMs = monitorState.lastStallEventTime
                ? (now - monitorState.lastStallEventTime)
                : null;
            const progressOk = monitorState.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS;
            const stableEnough = !video.paused
                && video.readyState >= 3
                && progressOk
                && (stallAgoMs === null || stallAgoMs >= CONFIG.recovery.CATCH_UP_STABLE_MS);

            if (!stableEnough) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Deferred (unstable)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts,
                    paused: video.paused,
                    readyState: video.readyState,
                    progressStreakMs: monitorState.progressStreakMs,
                    stallAgoMs
                });
                if (monitorState.catchUpAttempts < CONFIG.recovery.CATCH_UP_MAX_ATTEMPTS) {
                    monitorState.catchUpTimeoutId = setTimeout(() => {
                        attemptCatchUp(video, monitorState, reason);
                    }, CONFIG.recovery.CATCH_UP_RETRY_MS);
                }
                return;
            }

            const ranges = BufferGapFinder.getBufferRanges(video);
            if (!ranges.length) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (no buffer)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts
                });
                return;
            }

            const liveRange = ranges[ranges.length - 1];
            const bufferEnd = liveRange.end;
            const behindS = bufferEnd - video.currentTime;

            if (behindS < CONFIG.recovery.CATCH_UP_MIN_S) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (already near live)'), {
                    reason,
                    behindS: behindS.toFixed(2)
                });
                return;
            }

            const target = Math.max(video.currentTime, bufferEnd - CONFIG.recovery.HEAL_EDGE_GUARD_S);
            const validation = SeekTargetCalculator.validateSeekTarget(video, target);
            const bufferRanges = BufferGapFinder.formatRanges(ranges);

            if (!validation.valid) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (invalid target)'), {
                    reason,
                    target: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges,
                    validation: validation.reason
                });
                return;
            }

            try {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Seeking toward live edge'), {
                    reason,
                    from: video.currentTime.toFixed(3),
                    to: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges
                });
                video.currentTime = target;
                monitorState.lastCatchUpTime = now;
            } catch (error) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Seek failed'), {
                    reason,
                    error: error?.name,
                    message: error?.message
                });
            }
        };

        const attemptHeal = async (videoOrContext, monitorStateOverride) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId);
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId;

            if (state.isHealing) {
                Logger.add(LogEvents.tagged('BLOCKED', 'Already healing'));
                return;
            }

            if (!document.contains(video)) {
                Logger.add(LogEvents.tagged('DETACHED', 'Heal skipped, video not in DOM'), {
                    reason: 'pre_heal',
                    videoId
                });
                onDetached(video, 'pre_heal');
                return;
            }

            state.isHealing = true;
            state.healAttempts++;
            const healStartTime = performance.now();
            if (monitorState) {
                monitorState.state = 'HEALING';
                monitorState.lastHealAttemptTime = Date.now();
            }

            const startSnapshot = StateSnapshot.full(video, videoId);
            const startSummary = LogEvents.summary.healStart({
                attempt: state.healAttempts,
                lastProgressAgoMs: monitorState ? (Date.now() - monitorState.lastProgressTime) : null,
                currentTime: startSnapshot?.currentTime ? Number(startSnapshot.currentTime) : null,
                paused: startSnapshot?.paused,
                readyState: startSnapshot?.readyState,
                networkState: startSnapshot?.networkState,
                buffered: startSnapshot?.buffered
            });
            Logger.add(startSummary, {
                attempt: state.healAttempts,
                lastProgressAgoMs: monitorState ? (Date.now() - monitorState.lastProgressTime) : undefined,
                videoId,
                videoState: startSnapshot
            });

            try {
                const pollResult = await poller.pollForHealPoint(
                    video,
                    monitorState,
                    CONFIG.stall.HEAL_TIMEOUT_S * 1000
                );

                if (pollResult.aborted) {
                    Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted during polling'), {
                        reason: pollResult.reason || 'poll_abort',
                        videoId
                    });
                    onDetached(video, pollResult.reason || 'poll_abort');
                    return;
                }

                const healPoint = pollResult.healPoint;
                if (!healPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        Logger.add(LogEvents.tagged('SKIPPED', 'Video recovered, no heal needed'), {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                            finalState: VideoState.get(video, videoId)
                        });
                        recoveryManager.resetBackoff(monitorState, 'self_recovered');
                        if (recoveryManager.resetPlayError) {
                            recoveryManager.resetPlayError(monitorState, 'self_recovered');
                        }
                        return;
                    }

                    const noPointDuration = Number((performance.now() - healStartTime).toFixed(0));
                    const noPointSummary = LogEvents.summary.noHealPoint({
                        duration: noPointDuration,
                        currentTime: video.currentTime,
                        bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    });
                    Logger.add(noPointSummary, {
                        duration: noPointDuration + 'ms',
                        suggestion: 'User may need to refresh page',
                        currentTime: video.currentTime?.toFixed(3),
                        bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
                        finalState: VideoState.get(video, videoId)
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
                    if (monitorState) {
                        monitorState.lastHealPointKey = null;
                        monitorState.healPointRepeatCount = 0;
                    }
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted before revalidation'), {
                        reason: 'pre_revalidate',
                        videoId
                    });
                    onDetached(video, 'pre_revalidate');
                    return;
                }

                const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                if (!freshPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        Logger.add(LogEvents.tagged('STALE_RECOVERED', 'Heal point gone, but video recovered'), {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms'
                        });
                        recoveryManager.resetBackoff(monitorState, 'stale_recovered');
                        if (recoveryManager.resetPlayError) {
                            recoveryManager.resetPlayError(monitorState, 'stale_recovered');
                        }
                        return;
                    }
                    Logger.add(LogEvents.tagged('STALE_GONE', 'Heal point disappeared before seek'), {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        finalState: VideoState.get(video, videoId)
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'stale_gone');
                    if (monitorState) {
                        monitorState.lastHealPointKey = null;
                        monitorState.healPointRepeatCount = 0;
                    }
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted before seek'), {
                        reason: 'pre_seek',
                        videoId
                    });
                    onDetached(video, 'pre_seek');
                    return;
                }

                const targetPoint = freshPoint;
                if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                    Logger.add(LogEvents.tagged('POINT_UPDATED', 'Using refreshed heal point'), {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                        type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                    });
                }

                const isAbortError = (result) => (
                    result?.errorName === 'AbortError'
                    || (typeof result?.error === 'string' && result.error.includes('aborted'))
                );

                const isPlayFailure = (result) => (
                    isAbortError(result)
                    || result?.errorName === 'PLAY_STUCK'
                );

                const updateHealPointRepeat = (monitorStateRef, point, succeeded) => {
                    if (!monitorStateRef) return 0;
                    if (succeeded || !point) {
                        monitorStateRef.lastHealPointKey = null;
                        monitorStateRef.healPointRepeatCount = 0;
                        return 0;
                    }
                    const key = `${point.start.toFixed(2)}-${point.end.toFixed(2)}`;
                    if (monitorStateRef.lastHealPointKey === key) {
                        monitorStateRef.healPointRepeatCount = (monitorStateRef.healPointRepeatCount || 0) + 1;
                    } else {
                        monitorStateRef.lastHealPointKey = key;
                        monitorStateRef.healPointRepeatCount = 1;
                    }
                    return monitorStateRef.healPointRepeatCount;
                };

                const attemptSeekAndPlay = async (point, label) => {
                    if (label) {
                        Logger.add(LogEvents.tagged('RETRY', 'Retrying heal'), {
                            attempt: label,
                            healRange: `${point.start.toFixed(2)}-${point.end.toFixed(2)}`,
                            gapSize: point.gapSize?.toFixed(2),
                            isNudge: point.isNudge
                        });
                    }
                    return LiveEdgeSeeker.seekAndPlay(video, point);
                };

                let result = await attemptSeekAndPlay(targetPoint, null);
                let finalPoint = targetPoint;

                if (!result.success && isAbortError(result)) {
                    await Fn.sleep(CONFIG.recovery.HEAL_RETRY_DELAY_MS);
                    const retryPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                    if (retryPoint) {
                        finalPoint = retryPoint;
                        result = await attemptSeekAndPlay(retryPoint, 'abort_error');
                    } else {
                        Logger.add(LogEvents.tagged('RETRY_SKIP', 'Retry skipped, no heal point available'), {
                            reason: 'abort_error',
                            currentTime: video.currentTime?.toFixed(3),
                            bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                        });
                    }
                }

                const duration = Number((performance.now() - healStartTime).toFixed(0));

                if (result.success) {
                    const bufferEndDelta = getBufferEndDelta(video);
                    const completeSummary = LogEvents.summary.healComplete({
                        duration,
                        healAttempts: state.healAttempts,
                        bufferEndDelta
                    });
                    Logger.add(completeSummary, {
                        duration: duration + 'ms',
                        healAttempts: state.healAttempts,
                        bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null,
                        finalState: VideoState.get(video, videoId)
                    });
                    Metrics.increment('heals_successful');
                    recoveryManager.resetBackoff(monitorState, 'heal_success');
                    if (recoveryManager.resetPlayError) {
                        recoveryManager.resetPlayError(monitorState, 'heal_success');
                    }
                    scheduleCatchUp(video, monitorState, videoId, 'post_heal');
                } else {
                    const repeatCount = updateHealPointRepeat(monitorState, finalPoint, false);
                    if (isAbortError(result)) {
                        const bufferRanges = BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video));
                        Logger.add(LogEvents.tagged('ABORT_CONTEXT', 'Play aborted during heal'), {
                            error: result.error,
                            errorName: result.errorName,
                            stalledForMs: monitorState?.lastProgressTime
                                ? (Date.now() - monitorState.lastProgressTime)
                                : null,
                            bufferStarved: monitorState?.bufferStarved || false,
                            bufferStarvedSinceMs: monitorState?.bufferStarvedSince
                                ? (Date.now() - monitorState.bufferStarvedSince)
                                : null,
                            bufferStarveUntilMs: monitorState?.bufferStarveUntil
                                ? Math.max(monitorState.bufferStarveUntil - Date.now(), 0)
                                : null,
                            bufferAhead: monitorState?.lastBufferAhead ?? null,
                            bufferRanges,
                            readyState: video.readyState,
                            networkState: video.networkState
                        });
                    }
                    const failedSummary = LogEvents.summary.healFailed({
                        duration,
                        errorName: result.errorName,
                        error: result.error,
                        healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
                        gapSize: finalPoint?.gapSize,
                        isNudge: finalPoint?.isNudge
                    });
                    Logger.add(failedSummary, {
                        duration: duration + 'ms',
                        error: result.error,
                        errorName: result.errorName,
                        healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
                        isNudge: finalPoint?.isNudge,
                        gapSize: finalPoint?.gapSize?.toFixed(2),
                        finalState: VideoState.get(video, videoId)
                    });
                    Metrics.increment('heals_failed');
                    if (monitorState && recoveryManager.handlePlayFailure
                        && (isPlayFailure(result)
                            || repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT)) {
                        recoveryManager.handlePlayFailure(video, monitorState, {
                            reason: isPlayFailure(result) ? 'play_error' : 'healpoint_repeat',
                            error: result.error,
                            errorName: result.errorName,
                            healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
                            healPointRepeatCount: repeatCount
                        });
                    }
                }
            } catch (e) {
                Logger.add(LogEvents.tagged('ERROR', 'Unexpected error during heal'), {
                    error: e.name,
                    message: e.message,
                    stack: e.stack?.split('\n')[0]
                });
                Metrics.increment('heals_failed');
            } finally {
                state.isHealing = false;
                if (monitorState) {
                    if (video.paused) {
                        monitorState.state = 'PAUSED';
                    } else if (poller.hasRecovered(video, monitorState)) {
                        monitorState.state = 'PLAYING';
                    } else {
                        monitorState.state = 'STALLED';
                    }
                }
            }
        };

        return {
            attemptHeal,
            isHealing: () => state.isHealing,
            getAttempts: () => state.healAttempts
        };
    };

    return { create };
})();

// --- AdGapSignals ---
/**
 * Detects ad-gap-like buffered range gaps around stalled playheads.
 */
const AdGapSignals = (() => {
    const getEdgeThreshold = () => Math.max(0.25, CONFIG.recovery.HEAL_EDGE_GUARD_S || 0.25);

    const detectGap = (ranges, playheadSeconds, edgeThreshold) => {
        if (!ranges || ranges.length < 2 || !Number.isFinite(playheadSeconds)) return null;
        const threshold = Number.isFinite(edgeThreshold) ? edgeThreshold : getEdgeThreshold();
        for (let i = 0; i < ranges.length - 1; i++) {
            const range = ranges[i];
            const next = ranges[i + 1];
            if (playheadSeconds < range.start || playheadSeconds > range.end) {
                continue;
            }
            const gapSize = next.start - range.end;
            const nearEdge = Math.abs(range.end - playheadSeconds) <= threshold;
            if (gapSize > 0 && nearEdge) {
                return {
                    playheadSeconds,
                    rangeEnd: range.end,
                    nextRangeStart: next.start,
                    gapSize,
                    ranges
                };
            }
            break;
        }
        return null;
    };

    const maybeLog = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId || 'unknown';
        const monitorState = options.monitorState;
        const playheadSeconds = options.playheadSeconds;
        if (!video || !Number.isFinite(playheadSeconds)) return null;

        const now = options.now || Date.now();
        const lastLog = monitorState?.lastAdGapSignatureLogTime || 0;
        if (now - lastLog < CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
            return null;
        }

        const ranges = options.ranges || BufferGapFinder.getBufferRanges(video);
        const detection = detectGap(ranges, playheadSeconds, options.edgeThreshold);
        if (!detection) return null;

        if (monitorState) {
            monitorState.lastAdGapSignatureLogTime = now;
        }

        const formattedRanges = BufferGapFinder.formatRanges(detection.ranges);
        const summary = LogEvents.summary.adGapSignature({
            videoId,
            playheadSeconds: detection.playheadSeconds,
            rangeEnd: detection.rangeEnd,
            nextRangeStart: detection.nextRangeStart,
            gapSize: detection.gapSize,
            ranges: formattedRanges
        });

        Logger.add(summary, {
            videoId,
            reason: options.reason || null,
            playheadSeconds: Number(detection.playheadSeconds.toFixed(3)),
            rangeEnd: Number(detection.rangeEnd.toFixed(3)),
            nextRangeStart: Number(detection.nextRangeStart.toFixed(3)),
            gapSize: Number(detection.gapSize.toFixed(3)),
            ranges: formattedRanges
        });

        return detection;
    };

    return {
        detectGap,
        maybeLog
    };
})();

// --- PlayheadAttribution ---
/**
 * Resolves console playhead stall hints to a monitored video candidate.
 */
const PlayheadAttribution = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const matchWindowSeconds = Number.isFinite(options.matchWindowSeconds)
            ? options.matchWindowSeconds
            : 2;

        const formatSeconds = (value) => (
            Number.isFinite(value) ? Number(value.toFixed(3)) : null
        );

        const buildCandidates = (playheadSeconds) => {
            const candidates = [];
            for (const [videoId, entry] of monitorsById.entries()) {
                const currentTime = entry.video?.currentTime;
                if (!Number.isFinite(currentTime)) {
                    continue;
                }
                const deltaSeconds = Math.abs(currentTime - playheadSeconds);
                candidates.push({
                    videoId,
                    currentTime: formatSeconds(currentTime),
                    deltaSeconds: formatSeconds(deltaSeconds)
                });
            }
            candidates.sort((a, b) => a.deltaSeconds - b.deltaSeconds);
            return candidates;
        };

        const resolve = (playheadSeconds) => {
            const activeId = candidateSelector.getActiveId();
            if (!Number.isFinite(playheadSeconds)) {
                return {
                    id: activeId || null,
                    reason: activeId ? 'active_fallback' : 'no_active',
                    playheadSeconds: null,
                    activeId,
                    candidates: []
                };
            }
            const candidates = buildCandidates(playheadSeconds);
            if (!candidates.length) {
                return {
                    id: null,
                    reason: 'no_candidates',
                    playheadSeconds: formatSeconds(playheadSeconds),
                    activeId,
                    candidates
                };
            }
            const best = candidates[0];
            if (best.deltaSeconds <= matchWindowSeconds) {
                return {
                    id: best.videoId,
                    reason: best.videoId === activeId ? 'active_match' : 'closest_match',
                    playheadSeconds: formatSeconds(playheadSeconds),
                    activeId,
                    match: best,
                    candidates
                };
            }
            return {
                id: null,
                reason: 'no_match',
                playheadSeconds: formatSeconds(playheadSeconds),
                activeId,
                candidates
            };
        };

        return { resolve };
    };

    return { create };
})();

// --- VideoDiscovery ---
/**
 * Scans the DOM for video elements and wires the mutation observer.
 */
const VideoDiscovery = (() => {
    const collectVideos = (targetNode) => {
        if (targetNode) {
            if (targetNode.nodeName === 'VIDEO') {
                return [targetNode];
            }
            if (targetNode.querySelectorAll) {
                return Array.from(targetNode.querySelectorAll('video'));
            }
            return [];
        }
        return Array.from(document.querySelectorAll('video'));
    };

    const notifyVideos = (videos, onVideo) => {
        if (!videos.length) {
            return;
        }
        Logger.add('[CORE] New video detected in DOM', {
            count: videos.length
        });
        Logger.add('[CORE] Video elements found, starting StreamHealer', {
            count: videos.length
        });
        videos.forEach(video => onVideo(video));
    };

    const start = (onVideo) => {
        if (!document?.querySelectorAll) {
            return null;
        }

        const scan = (targetNode = null) => {
            const videos = collectVideos(targetNode);
            notifyVideos(videos, onVideo);
        };

        scan();

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.nodeName === 'VIDEO'
                        || (node.querySelector && node.querySelector('video')))) {
                        scan(node);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        Logger.add('[CORE] DOM observer started');
        return observer;
    };

    return { start };
})();

// --- ExternalSignalRouter ---
/**
 * Handles console-based external signal hints for recovery actions.
 */
const ExternalSignalRouter = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const logDebug = options.logDebug || (() => {});
        const onStallDetected = options.onStallDetected || (() => {});
        const onRescan = options.onRescan || (() => {});
        const playheadAttribution = PlayheadAttribution.create({
            monitorsById,
            candidateSelector,
            matchWindowSeconds: 2
        });

        const formatSeconds = (value) => (
            Number.isFinite(value) ? Number(value.toFixed(3)) : null
        );
        const truncateMessage = (message) => (
            String(message).substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN)
        );

        const getActiveEntry = () => {
            const activeId = candidateSelector.getActiveId();
            if (activeId && monitorsById.has(activeId)) {
                return { id: activeId, entry: monitorsById.get(activeId) };
            }
            const first = monitorsById.entries().next();
            if (!first.done) {
                return { id: first.value[0], entry: first.value[1] };
            }
            return null;
        };

        const logCandidateSnapshot = (reason) => {
            const candidates = [];
            for (const [videoId, entry] of monitorsById.entries()) {
                const score = candidateSelector.scoreVideo(entry.video, entry.monitor, videoId);
                candidates.push({
                    videoId,
                    score: score.score,
                    progressEligible: score.progressEligible,
                    progressStreakMs: score.progressStreakMs,
                    progressAgoMs: score.progressAgoMs,
                    readyState: score.vs.readyState,
                    bufferedLength: score.vs.bufferedLength,
                    paused: score.vs.paused,
                    currentSrc: score.vs.currentSrc,
                    reasons: score.reasons
                });
            }
            Logger.add(LogEvents.tagged('CANDIDATE_SNAPSHOT', 'Candidates scored'), {
                reason,
                candidates
            });
        };

        const probeCandidates = (reason, excludeId = null) => {
            if (!recoveryManager || typeof recoveryManager.probeCandidate !== 'function') {
                return;
            }
            const attempts = [];
            let attemptedCount = 0;
            for (const [videoId] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                const attempted = recoveryManager.probeCandidate(videoId, reason);
                attempts.push({ videoId, attempted });
                if (attempted) attemptedCount += 1;
            }
            Logger.add(LogEvents.tagged('PROBE_BURST', 'Probing candidates'), {
                reason,
                excludeId,
                attemptedCount,
                attempts
            });
        };

        const handleSignal = (signal = {}) => {
            if (!signal || monitorsById.size === 0) return;

            const type = signal.type || 'unknown';
            const level = signal.level || 'unknown';
            const message = signal.message || '';
            const url = signal.url || null;

            if (type === 'playhead_stall') {
                const attribution = playheadAttribution.resolve(signal.playheadSeconds);
                if (!attribution.id) {
                    Logger.add(LogEvents.tagged('STALL_HINT_UNATTRIBUTED', 'Console playhead stall warning'), {
                        level,
                        message: truncateMessage(message),
                        playheadSeconds: attribution.playheadSeconds,
                        bufferEndSeconds: formatSeconds(signal.bufferEndSeconds),
                        activeVideoId: attribution.activeId,
                        reason: attribution.reason,
                        candidates: attribution.candidates
                    });
                    return;
                }
                const active = getActiveEntry();
                const entry = monitorsById.get(attribution.id);
                if (!entry) return;
                const now = Date.now();
                const state = entry.monitor.state;
                state.lastStallEventTime = now;
                state.pauseFromStall = true;

                Logger.add(LogEvents.tagged('STALL_HINT', 'Console playhead stall warning'), {
                    videoId: attribution.id,
                    level,
                    message: truncateMessage(message),
                    playheadSeconds: attribution.playheadSeconds,
                    bufferEndSeconds: formatSeconds(signal.bufferEndSeconds),
                    attribution: attribution.reason,
                    activeVideoId: active ? active.id : null,
                    deltaSeconds: attribution.match ? attribution.match.deltaSeconds : null,
                    lastProgressAgoMs: state.lastProgressTime ? (now - state.lastProgressTime) : null,
                    videoState: VideoState.get(entry.video, attribution.id)
                });

                AdGapSignals.maybeLog({
                    video: entry.video,
                    videoId: attribution.id,
                    playheadSeconds: attribution.playheadSeconds,
                    monitorState: state,
                    now,
                    reason: 'console_stall'
                });

                if (!state.hasProgress || !state.lastProgressTime) {
                    return;
                }

                const stalledForMs = now - state.lastProgressTime;
                if (stalledForMs >= CONFIG.stall.STALL_CONFIRM_MS) {
                    onStallDetected(entry.video, {
                        trigger: 'CONSOLE_STALL',
                        stalledFor: stalledForMs + 'ms',
                        bufferExhausted: BufferGapFinder.isBufferExhausted(entry.video),
                        paused: entry.video.paused,
                        pauseFromStall: true
                    }, state);
                }
                return;
            }

            if (type === 'processing_asset') {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing/offline asset detected'), {
                    level,
                    message: truncateMessage(message)
                });

                if (candidateSelector && typeof candidateSelector.activateProbation === 'function') {
                    candidateSelector.activateProbation('processing_asset');
                }

                logCandidateSnapshot('processing_asset');
                onRescan('processing_asset', { level, message: truncateMessage(message) });

                if (recoveryManager.isFailoverActive()) {
                    logDebug(LogEvents.tagged('ASSET_HINT_SKIP', 'Failover in progress'), {
                        reason: 'processing_asset'
                    });
                    return;
                }

                const best = candidateSelector.evaluateCandidates('processing_asset');
                let activeId = candidateSelector.getActiveId();
                const activeEntry = activeId ? monitorsById.get(activeId) : null;
                const activeMonitorState = activeEntry ? activeEntry.monitor.state : null;
                const activeState = activeMonitorState ? activeMonitorState.state : null;
                const activeIsStalled = !activeEntry || ['STALLED', 'RESET', 'ERROR'].includes(activeState);
                const activeIsSevere = activeIsStalled
                    && (activeState === 'RESET'
                        || activeState === 'ERROR'
                        || activeMonitorState?.bufferStarved);

                if (best && best.id && activeId && best.id !== activeId && best.progressEligible && activeIsSevere) {
                    const fromId = activeId;
                    activeId = best.id;
                    candidateSelector.setActiveId(activeId);
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Forced switch after processing asset'), {
                        from: fromId,
                        to: activeId,
                        bestScore: best.score,
                        progressStreakMs: best.progressStreakMs,
                        progressEligible: best.progressEligible,
                        activeState,
                        bufferStarved: activeMonitorState?.bufferStarved || false
                    });
                } else if (best && best.id && best.id !== activeId) {
                    logDebug(LogEvents.tagged('CANDIDATE', 'Processing asset switch suppressed'), {
                        from: activeId,
                        to: best.id,
                        progressEligible: best.progressEligible,
                        activeState,
                        bufferStarved: activeMonitorState?.bufferStarved || false,
                        activeIsSevere
                    });
                    if (activeIsStalled) {
                        recoveryManager.probeCandidate(best.id, 'processing_asset');
                    }
                }

                if (activeIsStalled) {
                    probeCandidates('processing_asset', activeId);
                }

                const activeEntryForPlay = activeId ? monitorsById.get(activeId) : null;
                if (activeEntryForPlay) {
                    const playPromise = activeEntryForPlay.video?.play?.();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch((err) => {
                            Logger.add(LogEvents.tagged('ASSET_HINT_PLAY', 'Play rejected'), {
                                videoId: activeId,
                                error: err?.name,
                                message: err?.message
                            });
                        });
                    }
                }
                return;
            }

            if (type === 'adblock_block') {
                Logger.add(LogEvents.tagged('ADBLOCK_HINT', 'Ad-block signal observed'), {
                    type,
                    level,
                    message: truncateMessage(message),
                    url: url ? truncateMessage(url) : null
                });
                return;
            }

            Logger.add(LogEvents.tagged('EXTERNAL', 'Unhandled external signal'), {
                type,
                level,
                message: truncateMessage(message)
            });
        };

        return { handleSignal };
    };

    return { create };
})();



// --- MonitoringOrchestrator ---
/**
 * Sets up monitoring, candidate scoring, and recovery helpers.
 */
const MonitoringOrchestrator = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const isHealing = options.isHealing || (() => false);
        const isFallbackSource = options.isFallbackSource || (() => false);
        let stallHandler = options.onStall || (() => {});

        const monitorRegistry = MonitorRegistry.create({
            logDebug,
            isHealing,
            onStall: (video, details, state) => stallHandler(video, details, state)
        });

        const monitorsById = monitorRegistry.monitorsById;
        const getVideoId = monitorRegistry.getVideoId;

        const candidateSelector = CandidateSelector.create({
            monitorsById,
            getVideoId,
            logDebug,
            maxMonitors: CONFIG.monitoring.MAX_VIDEO_MONITORS,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
            isFallbackSource
        });

        const setStallHandler = (fn) => {
            stallHandler = typeof fn === 'function' ? fn : (() => {});
        };

        const coordinator = MonitorCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug
        });

        const recoveryManager = RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            onRescan: coordinator.scanForVideos,
            onPersistentFailure: (videoId, detail = {}) => coordinator.refreshVideo(videoId, detail)
        });
        candidateSelector.setLockChecker(recoveryManager.isFailoverActive);
        monitorRegistry.bind({ candidateSelector, recoveryManager });

        return {
            monitor: coordinator.monitor,
            stopMonitoring: coordinator.stopMonitoring,
            monitorsById,
            getVideoId,
            candidateSelector,
            recoveryManager,
            scanForVideos: coordinator.scanForVideos,
            setStallHandler,
            getMonitoredCount: () => coordinator.getMonitoredCount()
        };
    };

    return { create };
})();

// --- RecoveryOrchestrator ---
/**
 * Coordinates stall handling, healing, and external signal recovery.
 */
const RecoveryOrchestrator = (() => {
    const create = (options = {}) => {
        const monitoring = options.monitoring;
        const logWithState = options.logWithState;
        const logDebug = options.logDebug || (() => {});

        const monitorsById = monitoring.monitorsById;
        const candidateSelector = monitoring.candidateSelector;
        const recoveryManager = monitoring.recoveryManager;
        const getVideoId = monitoring.getVideoId;

        const stallSkipLogTimes = new Map();

        const healPipeline = HealPipeline.create({
            getVideoId,
            logWithState,
            logDebug,
            recoveryManager,
            onDetached: (video, reason) => {
                monitoring.scanForVideos('detached', {
                    reason,
                    videoId: getVideoId(video)
                });
            }
        });

        const maybeLogResourceWindow = (context, details, now) => {
            const state = context.monitorState;
            if (!state) return;
            if (state.lastResourceWindowLogTime
                && (now - state.lastResourceWindowLogTime) <= CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                return;
            }
            state.lastResourceWindowLogTime = now;
            const stallKey = state.stallStartTime
                || state.lastProgressTime
                || now;
            if (Instrumentation && typeof Instrumentation.logResourceWindow === 'function') {
                Instrumentation.logResourceWindow({
                    videoId: context.videoId,
                    stallTime: now,
                    stallKey,
                    reason: details.trigger || 'stall',
                    stalledFor: details.stalledFor || null
                });
            }
        };

        const shouldDebounceAfterProgress = (context, now) => {
            const state = context.monitorState;
            if (!state) return false;
            const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
            if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                logDebug(LogEvents.tagged('DEBOUNCE'), {
                    cooldownMs: CONFIG.stall.RETRY_COOLDOWN_MS,
                    lastHealAttemptAgoMs: now - state.lastHealAttemptTime,
                    state: state.state,
                    videoId: context.videoId
                });
                return true;
            }
            return false;
        };

        const markHealAttempt = (context, now) => {
            if (context.monitorState) {
                context.monitorState.lastHealAttemptTime = now;
            }
        };

        const maybeRescanBufferStarved = (context, now) => {
            const state = context.monitorState;
            if (!state?.bufferStarved) return;
            const lastRescan = state.lastBufferStarveRescanTime || 0;
            if (now - lastRescan < CONFIG.stall.BUFFER_STARVE_RESCAN_COOLDOWN_MS) {
                return;
            }
            state.lastBufferStarveRescanTime = now;
            candidateSelector.activateProbation('buffer_starved');
            const bufferInfo = MediaState.bufferAhead(context.video);
            monitoring.scanForVideos('buffer_starved', {
                videoId: context.videoId,
                bufferAhead: bufferInfo?.bufferAhead ?? null,
                hasBuffer: bufferInfo?.hasBuffer ?? null
            });
        };

        const shouldSkipNonActive = (context, details, now) => {
            const activeCandidateId = candidateSelector.getActiveId();
            if (!activeCandidateId || activeCandidateId === context.videoId) {
                return false;
            }
            if (!context.monitorState?.progressEligible) {
                recoveryManager.probeCandidate(context.videoId, 'stall_non_active');
            }
            const lastLog = stallSkipLogTimes.get(context.videoId) || 0;
            const logIntervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
            if (now - lastLog >= logIntervalMs) {
                stallSkipLogTimes.set(context.videoId, now);
                logDebug(LogEvents.tagged('STALL_SKIP', 'Stall on non-active video'), {
                    videoId: context.videoId,
                    activeVideoId: activeCandidateId,
                    stalledFor: details.stalledFor
                });
            }
            return true;
        };

        const logStallDetected = (context, details, now) => {
            const snapshot = context.getSnapshot();
            const summary = LogEvents.summary.stallDetected({
                videoId: context.videoId,
                trigger: details.trigger,
                stalledFor: details.stalledFor,
                bufferExhausted: details.bufferExhausted,
                paused: context.video.paused,
                pauseFromStall: context.monitorState?.pauseFromStall,
                lastProgressAgoMs: context.monitorState ? (now - context.monitorState.lastProgressTime) : null,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered
            });
            Logger.add(summary, {
                ...details,
                lastProgressAgoMs: context.monitorState ? (now - context.monitorState.lastProgressTime) : undefined,
                videoId: context.videoId,
                videoState: snapshot
            });
        };

        const onStallDetected = (video, details = {}, state = null) => {
            const now = Date.now();
            const context = RecoveryContext.create(video, state, getVideoId, {
                trigger: details.trigger,
                reason: details.trigger || 'stall',
                stalledFor: details.stalledFor,
                now
            });

            maybeLogResourceWindow(context, details, now);

            if (recoveryManager.shouldSkipStall(context.videoId, context.monitorState)) {
                return;
            }

            if (shouldDebounceAfterProgress(context, now)) {
                return;
            }
            markHealAttempt(context, now);
            maybeRescanBufferStarved(context, now);

            AdGapSignals.maybeLog({
                video: context.video,
                videoId: context.videoId,
                playheadSeconds: context.video?.currentTime,
                monitorState: context.monitorState,
                now,
                reason: details.trigger || 'stall'
            });

            candidateSelector.evaluateCandidates('stall');
            if (shouldSkipNonActive(context, details, now)) {
                return;
            }

            logStallDetected(context, details, now);

            Metrics.increment('stalls_detected');
            healPipeline.attemptHeal(context);
        };

        monitoring.setStallHandler(onStallDetected);

        const externalSignalRouter = ExternalSignalRouter.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug,
            onStallDetected,
            onRescan: (reason, detail) => monitoring.scanForVideos(reason, detail)
        });

        return {
            onStallDetected,
            attemptHeal: (video, state) => healPipeline.attemptHeal(video, state),
            handleExternalSignal: (signal = {}) => externalSignalRouter.handleSignal(signal),
            isHealing: () => healPipeline.isHealing(),
            getAttempts: () => healPipeline.getAttempts()
        };
    };

    return { create };
})();


// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;

    const logDebug = (message, detail) => {
        if (CONFIG.debug) {
            Logger.add(message, detail);
        }
    };

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);

    let recovery = {
        isHealing: () => false
    };

    const monitoring = MonitoringOrchestrator.create({
        logDebug,
        isHealing: () => recovery.isHealing(),
        isFallbackSource
    });

    const logWithState = (message, videoOrContext, detail = {}) => {
        const context = RecoveryContext.from(videoOrContext, null, monitoring.getVideoId);
        const snapshot = StateSnapshot.full(context.video, context.videoId);
        Logger.add(message, {
            ...detail,
            videoId: detail.videoId || context.videoId,
            videoState: snapshot
        });
    };

    recovery = RecoveryOrchestrator.create({
        monitoring,
        logWithState,
        logDebug
    });

    return {
        monitor: monitoring.monitor,
        stopMonitoring: monitoring.stopMonitoring,
        onStallDetected: recovery.onStallDetected,
        attemptHeal: (video, state) => recovery.attemptHeal(video, state),
        handleExternalSignal: (signal) => recovery.handleExternalSignal(signal),
        scanForVideos: monitoring.scanForVideos,
        getStats: () => ({
            healAttempts: recovery.getAttempts(),
            isHealing: recovery.isHealing(),
            monitoredCount: monitoring.getMonitoredCount()
        })
    };
})();

// ============================================================================
// 6. CORE ORCHESTRATOR (Stream Healer Edition)
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * STREAMLINED: Focus on stream healing, not ad blocking (uBO handles that).
 */
const CoreOrchestrator = (() => {
    return {
        init: () => {
            Logger.add('[CORE] Initializing Stream Healer');

            // Don't run in iframes
            if (window.self !== window.top) return;

            // Initialize essential modules only
            Instrumentation.init({
                onSignal: StreamHealer.handleExternalSignal
            });  // Console capture + external hints

            // Wait for DOM then start monitoring
            const startMonitoring = () => {
                VideoDiscovery.start((video) => {
                    StreamHealer.monitor(video);
                });
            };

            if (document.body) {
                startMonitoring();
            } else {
                document.addEventListener('DOMContentLoaded', startMonitoring, { once: true });
            }

            // Expose debug functions robustly
            const exposeGlobal = (name, fn) => {
                try {
                    window[name] = fn;
                    if (typeof unsafeWindow !== 'undefined') {
                        unsafeWindow[name] = fn;
                    }
                } catch (e) {
                    console.error('[CORE] Failed to expose global:', name, e);
                }
            };

            exposeGlobal('exportTwitchAdLogs', () => {
                const healerStats = StreamHealer.getStats();
                const metricsSummary = Metrics.getSummary();
                const mergedLogs = Logger.getMergedTimeline();
                ReportGenerator.exportReport(metricsSummary, mergedLogs, healerStats);
            });

            Logger.add('[CORE] Stream Healer ready', {
                config: {
                    watchdogInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                    healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
                }
            });

            const warnings = ConfigValidator.validate(CONFIG);
            if (warnings.length > 0) {
                Logger.add('[CORE] Config validation warnings', {
                    count: warnings.length,
                    warnings
                });
            }
        }
    };
})();

CoreOrchestrator.init();


})();
