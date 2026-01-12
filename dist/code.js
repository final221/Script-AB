// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       4.0.56
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
            PROGRESS_RECENT_MS: 2000,       // "Recent progress" threshold for scoring
            PROGRESS_STALE_MS: 5000,        // "Stale progress" threshold for scoring
            TRUST_STALE_MS: 8000,           // Trust expires if progress is older than this
            PROBE_COOLDOWN_MS: 5000,        // Min time between probe attempts per candidate
        },

        recovery: {
            MIN_HEAL_BUFFER_S: 2,           // Minimum buffered seconds needed to heal
            SEEK_SETTLE_MS: 100,            // Wait after seek before validation
            PLAYBACK_VERIFY_MS: 200,        // Wait after play to verify playback
        },

        logging: {
            LOG_CSP_WARNINGS: true,
            NON_ACTIVE_LOG_MS: 300000,      // Non-active candidate log interval
            ACTIVE_LOG_MS: 5000,            // Active candidate log interval
            BACKOFF_LOG_INTERVAL_MS: 5000,  // Backoff skip log interval
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
                Logger.add('[HEALER:BUFFER_ERROR] Buffer ranges changed during read', {
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
                Logger.add('[HEALER:BUFFER_ERROR] Buffer exhaustion check failed', {
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
        isBufferExhausted
    };
})();

// --- HealPointFinder ---
/**
 * Finds heal points in buffered ranges.
 */
const HealPointFinder = (() => {
    const MIN_HEAL_BUFFER_S = CONFIG.recovery.MIN_HEAL_BUFFER_S;

    const findHealPoint = (video, options = {}) => {
        if (!video) {
            if (!options.silent) {
                Logger.add('[HEALER:ERROR] No video element');
            }
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = BufferRanges.getBufferRanges(video);

        if (!options.silent) {
            Logger.add('[HEALER:SCAN] Scanning for heal point', {
                currentTime: currentTime.toFixed(3),
                bufferRanges: BufferRanges.formatRanges(ranges),
                rangeCount: ranges.length
            });
        }

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const effectiveStart = Math.max(range.start, currentTime);
            const contentAhead = range.end - effectiveStart;

            if (contentAhead > MIN_HEAL_BUFFER_S) {
                let healStart = range.start;
                let isNudge = false;

                if (range.start <= currentTime) {
                    healStart = currentTime + 0.5;
                    isNudge = true;

                    if (healStart >= range.end - 0.1) {
                        if (!options.silent) {
                            Logger.add('[HEALER:SKIP] Nudge target too close to buffer end');
                        }
                        continue;
                    }
                }

                const healPoint = {
                    start: healStart,
                    end: range.end,
                    gapSize: healStart - currentTime,
                    isNudge: isNudge
                };

                if (!options.silent) {
                    Logger.add(isNudge ? '[HEALER:NUDGE] Contiguous buffer found' : '[HEALER:FOUND] Heal point identified', {
                        healPoint: `${healStart.toFixed(3)}-${range.end.toFixed(3)}`,
                        gapSize: healPoint.gapSize.toFixed(2) + 's',
                        bufferAhead: contentAhead.toFixed(2) + 's'
                    });
                }

                return healPoint;
            }
        }

        if (!options.silent) {
            Logger.add('[HEALER:NONE] No valid heal point found', {
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

        if (bufferSize < 1) {
            return start + (bufferSize * 0.5);
        }

        const offset = Math.min(0.5, bufferSize - 1);
        return start + offset;
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

        Logger.add('[HEALER:SEEK] Attempting seek', {
            from: fromTime.toFixed(3),
            to: target.toFixed(3),
            healRange: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
            valid: validation.valid,
            headroom: validation.headroom?.toFixed(2)
        });

        if (!validation.valid) {
            Logger.add('[HEALER:SEEK_ABORT] Invalid seek target', {
                target: target.toFixed(3),
                reason: validation.reason
            });
            return { success: false, error: validation.reason };
        }

        // Perform seek
        try {
            video.currentTime = target;

            // Brief wait for seek to settle
            await Fn.sleep(CONFIG.recovery.SEEK_SETTLE_MS);

            Logger.add('[HEALER:SEEKED] Seek completed', {
                newTime: video.currentTime.toFixed(3),
                readyState: video.readyState
            });
        } catch (e) {
            Logger.add('[HEALER:SEEK_ERROR] Seek failed', {
                error: e.name,
                message: e.message
            });
            return { success: false, error: e.message };
        }

        // Attempt playback
        if (video.paused) {
            Logger.add('[HEALER:PLAY] Attempting play');
            try {
                await video.play();

                // Verify playback started
                await Fn.sleep(CONFIG.recovery.PLAYBACK_VERIFY_MS);

                if (!video.paused && video.readyState >= 3) {
                    const duration = (performance.now() - startTime).toFixed(0);
                    Logger.add('[HEALER:SUCCESS] Playback resumed', {
                        duration: duration + 'ms',
                        currentTime: video.currentTime.toFixed(3),
                        readyState: video.readyState
                    });
                    return { success: true };
                } else {
                    Logger.add('[HEALER:PLAY_STUCK] Play returned but not playing', {
                        paused: video.paused,
                        readyState: video.readyState
                    });
                    return { success: false, error: 'Play did not resume' };
                }
            } catch (e) {
                Logger.add('[HEALER:PLAY_ERROR] Play failed', {
                    error: e.name,
                    message: e.message
                });
                return { success: false, error: e.message };
            }
        } else {
            // Video already playing
            Logger.add('[HEALER:ALREADY_PLAYING] Video resumed on its own');
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
    const BENIGN_PATTERNS = ['graphql', 'unauthenticated', 'pinnedchatsettings'];

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
     * @param {'log'|'warn'|'error'} level
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



// --- Metrics ---
/**
 * High-level telemetry and metrics tracking for Stream Healer.
 * Streamlined: Only tracks stream healing metrics.
 * @responsibility Collects and calculates application metrics.
 */
const Metrics = (() => {
    const counters = {
        stalls_detected: 0,
        heals_successful: 0,
        heals_failed: 0,
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
        heal_rate: counters.stalls_detected > 0
            ? ((counters.heals_successful / counters.stalls_detected) * 100).toFixed(1) + '%'
            : 'N/A',
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
 * Streamlined: Shows stream healing metrics instead of ad-blocking stats.
 */
const ReportGenerator = (() => {
    const generateContent = (metricsSummary, logs) => {
        // Header with metrics
        const header = `[STREAM HEALER METRICS]
Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Stalls Detected: ${metricsSummary.stalls_detected}
Heals Successful: ${metricsSummary.heals_successful}
Heals Failed: ${metricsSummary.heals_failed}
Heal Rate: ${metricsSummary.heal_rate}
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
        a.download = `stream_healer_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
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

// --- ConsoleInterceptor ---
/**
 * Captures console output and forwards to callbacks.
 */
const ConsoleInterceptor = (() => {
    const create = (options = {}) => {
        const onLog = options.onLog || (() => {});
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

    const create = (options = {}) => {
        const emitSignal = options.emitSignal || (() => {});
        const lastSignalTimes = {
            playhead_stall: 0,
            processing_asset: 0
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
            Logger.add('[INSTRUMENT:REJECTION] Unhandled promise rejection', {
                reason: event.reason
                    ? truncateMessage(event.reason, CONFIG.logging.LOG_REASON_MAX_LEN)
                    : 'Unknown',
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

    const setupResourceObserver = () => {
        if (typeof window === 'undefined' || !window.PerformanceObserver) return;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry?.name && PROCESSING_ASSET_PATTERN.test(entry.name)) {
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
        },
        onError: (args) => {
            Logger.captureConsole('error', args);

            const msg = args.map(String).join(' ');
            const classification = classifyError(null, msg);

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
                features: ['globalErrors', 'consoleLogs', 'consoleErrors', 'consoleWarns'],
                consoleCapture: true,
                externalSignals: Boolean(externalSignalHandler)
            });
            setupGlobalErrorHandlers();
            setupResourceObserver();
            consoleInterceptor.attach();
        },
    };
})();

// --- VideoState ---
/**
 * Shared helper for consistent video state logging.
 */
const VideoState = (() => {
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

    return {
        get: (video, id) => {
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
        },
        getLite
    };
})();

// --- PlaybackStateTracker ---
/**
 * Shared playback state tracking for PlaybackMonitor.
 */
const PlaybackStateTracker = (() => {
    const PROGRESS_EPSILON = 0.05;

    const create = (video, videoId, logDebug) => {
        const state = {
            lastProgressTime: 0,
            lastTime: video.currentTime,
            progressStartTime: null,
            progressStreakMs: 0,
            progressEligible: false,
            hasProgress: false,
            firstSeenTime: Date.now(),
            firstReadyTime: 0,
            initialProgressTimeoutLogged: false,
            noHealPointCount: 0,
            nextHealAllowedTime: 0,
            lastBackoffLogTime: 0,
            initLogEmitted: false,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0,
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
            lastSrcAttr: video.getAttribute ? (video.getAttribute('src') || '') : '',
            lastReadyState: video.readyState,
            lastNetworkState: video.networkState,
            lastBufferedLength: (() => {
                try {
                    return video.buffered ? video.buffered.length : 0;
                } catch (error) {
                    return 0;
                }
            })(),
            lastStallEventTime: 0,
            pauseFromStall: false
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

            if (!state.progressStartTime
                || (progressGapMs !== null && progressGapMs > CONFIG.monitoring.PROGRESS_STREAK_RESET_MS)) {
                if (state.progressStartTime) {
                    logDebug('[HEALER:PROGRESS] Progress streak reset', {
                        reason,
                        progressGapMs,
                        previousStreakMs: state.progressStreakMs,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                state.progressStartTime = now;
                state.progressStreakMs = 0;
                state.progressEligible = false;
            } else {
                state.progressStreakMs = now - state.progressStartTime;
            }

            state.lastProgressTime = now;
            state.pauseFromStall = false;

            if (!state.progressEligible
                && state.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS) {
                state.progressEligible = true;
                logDebug('[HEALER:PROGRESS] Candidate eligibility reached', {
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                    videoState: VideoState.get(video, videoId)
                });
            }

            if (!state.hasProgress) {
                state.hasProgress = true;
                logDebug('[HEALER:PROGRESS] Initial progress observed', {
                    reason,
                    videoState: VideoState.get(video, videoId)
                });
            }

            if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
                logDebug('[HEALER:BACKOFF] Cleared after progress', {
                    reason,
                    previousNoHealPoints: state.noHealPointCount,
                    previousNextHealAllowedMs: state.nextHealAllowedTime
                        ? (state.nextHealAllowedTime - now)
                        : 0
                });
                state.noHealPointCount = 0;
                state.nextHealAllowedTime = 0;
            }
        };

        const markReady = (reason) => {
            if (state.firstReadyTime) return;
            const src = video.currentSrc || video.getAttribute('src') || '';
            if (!src && video.readyState < 1) {
                return;
            }
            state.firstReadyTime = Date.now();
            logDebug('[HEALER:READY] Initial ready state observed', {
                reason,
                readyState: video.readyState,
                currentSrc: src
            });
        };

        const markStallEvent = (reason) => {
            state.lastStallEventTime = Date.now();
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
                logDebug('[HEALER:STALL] Marked paused due to stall', {
                    reason,
                    videoState: VideoState.get(video, videoId)
                });
            }
        };

        const handleReset = (reason, onReset) => {
            const vs = VideoState.get(video, videoId);
            const ranges = BufferGapFinder.getBufferRanges(video);
            const hasBuffer = ranges.length > 0;
            const hasSrc = Boolean(vs.currentSrc || vs.src);
            const lowReadyState = vs.readyState <= 1;
            const isHardReset = !hasSrc && lowReadyState;
            const isSoftReset = lowReadyState
                && !hasBuffer
                && (vs.networkState === 0 || vs.networkState === 3);

            logDebug('[HEALER:RESET_CHECK] Reset evaluation', {
                reason,
                hasSrc,
                readyState: vs.readyState,
                networkState: vs.networkState,
                bufferRanges: BufferGapFinder.formatRanges(ranges),
                lastSrc: state.lastSrc,
                hardReset: isHardReset,
                softReset: isSoftReset
            });

            if (!isHardReset && !isSoftReset) {
                logDebug('[HEALER:RESET_SKIP] Reset suppressed', {
                    reason,
                    hasSrc,
                    readyState: vs.readyState,
                    networkState: vs.networkState,
                    hasBuffer
                });
                return;
            }

            state.state = 'RESET';
            logDebug('[HEALER:RESET] Video reset', {
                reason,
                resetType: isHardReset ? 'hard' : 'soft',
                videoState: vs
            });
            onReset({ reason, videoState: vs }, state);
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
                        logDebug('[HEALER:WATCHDOG] Awaiting initial progress', {
                            state: state.state,
                            graceMs,
                            baseline: state.firstReadyTime ? 'ready' : 'seen',
                            videoState: VideoState.get(video, videoId)
                        });
                    }
                    return true;
                }

                if (!state.initialProgressTimeoutLogged) {
                    state.initialProgressTimeoutLogged = true;
                    logDebug('[HEALER:WATCHDOG] Initial progress timeout', {
                        state: state.state,
                        waitedMs: now - baselineTime,
                        graceMs,
                        baseline: state.firstReadyTime ? 'ready' : 'seen',
                        videoState: VideoState.get(video, videoId)
                    });
                }

                return false;
            }
            return false;
        };

        return {
            state,
            updateProgress,
            markStallEvent,
            markReady,
            handleReset,
            shouldSkipUntilProgress
        };
    };

    return { create };
})();

// --- PlaybackEventHandlers ---
/**
 * Wires media element events to playback state tracking.
 */
const PlaybackEventHandlers = (() => {
    const LOG = {
        EVENT: '[HEALER:EVENT]'
    };

    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const onReset = options.onReset || (() => {});

        const handlers = {
            timeupdate: () => {
                tracker.updateProgress('timeupdate');
                if (state.state !== 'PLAYING') {
                    logDebug(`${LOG.EVENT} timeupdate`, {
                        state: state.state,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                if (!video.paused && state.state !== 'HEALING') {
                    setState('PLAYING', 'timeupdate');
                }
            },
            playing: () => {
                tracker.markReady('playing');
                state.pauseFromStall = false;
                state.lastTime = video.currentTime;
                logDebug(`${LOG.EVENT} playing`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (state.state !== 'HEALING') {
                    setState('PLAYING', 'playing');
                }
            },
            loadedmetadata: () => {
                tracker.markReady('loadedmetadata');
                logDebug(`${LOG.EVENT} loadedmetadata`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
            },
            loadeddata: () => {
                tracker.markReady('loadeddata');
                logDebug(`${LOG.EVENT} loadeddata`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
            },
            canplay: () => {
                tracker.markReady('canplay');
                logDebug(`${LOG.EVENT} canplay`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
            },
            waiting: () => {
                tracker.markStallEvent('waiting');
                logDebug(`${LOG.EVENT} waiting`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'waiting');
                }
            },
            stalled: () => {
                tracker.markStallEvent('stalled');
                logDebug(`${LOG.EVENT} stalled`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'stalled');
                }
            },
            pause: () => {
                const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
                logDebug(`${LOG.EVENT} pause`, {
                    state: state.state,
                    bufferExhausted,
                    videoState: VideoState.get(video, videoId)
                });
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
                logDebug(`${LOG.EVENT} ended`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                Logger.add('[HEALER:ENDED] Video ended', {
                    videoId,
                    videoState: VideoState.get(video, videoId)
                });
                setState('ENDED', 'ended');
            },
            error: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} error`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                setState('ERROR', 'error');
            },
            abort: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} abort`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                setState('PAUSED', 'abort');
                tracker.handleReset('abort', onReset);
            },
            emptied: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} emptied`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                tracker.handleReset('emptied', onReset);
            },
            suspend: () => {
                logDebug(`${LOG.EVENT} suspend`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
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
        WATCHDOG: '[HEALER:WATCHDOG]'
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

        const tick = () => {
            const now = Date.now();
            if (!document.contains(video)) {
                Logger.add('[HEALER:CLEANUP] Video removed from DOM', {
                    videoId
                });
                onRemoved();
                return;
            }

            if (isHealing()) {
                return;
            }

            const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
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

            const currentSrc = video.currentSrc || video.getAttribute('src') || '';
            if (currentSrc !== state.lastSrc) {
                logDebug('[HEALER:SRC] Source changed', {
                    previous: state.lastSrc,
                    current: currentSrc,
                    videoState: VideoState.get(video, videoId)
                });
                state.lastSrc = currentSrc;
            }

            const srcAttr = video.getAttribute ? (video.getAttribute('src') || '') : '';
            if (srcAttr !== state.lastSrcAttr) {
                logDebug('[HEALER:MEDIA_STATE] src attribute changed', {
                    previous: state.lastSrcAttr,
                    current: srcAttr,
                    videoState: VideoState.getLite(video, videoId)
                });
                state.lastSrcAttr = srcAttr;
            }

            const readyState = video.readyState;
            if (readyState !== state.lastReadyState) {
                logDebug('[HEALER:MEDIA_STATE] readyState changed', {
                    previous: state.lastReadyState,
                    current: readyState,
                    videoState: VideoState.getLite(video, videoId)
                });
                state.lastReadyState = readyState;
            }

            const networkState = video.networkState;
            if (networkState !== state.lastNetworkState) {
                logDebug('[HEALER:MEDIA_STATE] networkState changed', {
                    previous: state.lastNetworkState,
                    current: networkState,
                    videoState: VideoState.getLite(video, videoId)
                });
                state.lastNetworkState = networkState;
            }

            let bufferedLength = 0;
            try {
                bufferedLength = video.buffered ? video.buffered.length : 0;
            } catch (error) {
                bufferedLength = state.lastBufferedLength;
            }
            if (bufferedLength !== state.lastBufferedLength) {
                logDebug('[HEALER:MEDIA_STATE] buffered range count changed', {
                    previous: state.lastBufferedLength,
                    current: bufferedLength,
                    videoState: VideoState.getLite(video, videoId)
                });
                state.lastBufferedLength = bufferedLength;
            }

            const lastProgressTime = state.lastProgressTime || state.firstSeenTime || now;
            const stalledForMs = now - lastProgressTime;
            if (stalledForMs < CONFIG.stall.STALL_CONFIRM_MS) {
                return;
            }

            const confirmMs = bufferExhausted
                ? CONFIG.stall.STALL_CONFIRM_MS
                : CONFIG.stall.STALL_CONFIRM_MS + CONFIG.stall.STALL_CONFIRM_BUFFER_OK_MS;

            if (stalledForMs < confirmMs) {
                return;
            }

            if (state.state !== 'STALLED') {
                setState('STALLED', 'watchdog_no_progress');
            }

            const logIntervalMs = isActive()
                ? CONFIG.logging.ACTIVE_LOG_MS
                : CONFIG.logging.NON_ACTIVE_LOG_MS;
            if (now - state.lastWatchdogLogTime > logIntervalMs) {
                state.lastWatchdogLogTime = now;
                logDebug(`${LOG.WATCHDOG} No progress observed`, {
                    stalledForMs,
                    bufferExhausted,
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
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
        STATE: '[HEALER:STATE]'
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
            logDebug(LOG.STATE, {
                from: prevState,
                to: nextState,
                reason,
                pauseFromStall: state.pauseFromStall,
                progressStreakMs: state.progressStreakMs,
                progressEligible: state.progressEligible,
                lastProgressAgoMs: state.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                videoState: VideoState.get(video, videoId)
            });
        };

        const eventHandlers = PlaybackEventHandlers.create({
            video,
            videoId,
            logDebug,
            tracker,
            state,
            setState,
            onReset
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
            logDebug('[HEALER:MONITOR] PlaybackMonitor started', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            eventHandlers.attach();
            watchdog.start();
        };

        const stop = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor stopped', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
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
                logDebug('[HEALER:CANDIDATE] Switch suppressed', {
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
                currentScore
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
    const BAD_REASONS = ['fallback_src', 'ended', 'not_in_dom', 'reset', 'error_state', 'error'];

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
        const scorer = CandidateScorer.create({ minProgressMs, isFallbackSource });
        const switchPolicy = CandidateSwitchPolicy.create({
            switchDelta,
            minProgressMs,
            logDebug
        });

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const getActiveId = () => {
            if (!activeCandidateId && monitorsById.size > 0) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : monitorsById.keys().next().value;
                if (fallbackId) {
                    activeCandidateId = fallbackId;
                    Logger.add('[HEALER:CANDIDATE] Active video set', {
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
            if (lockChecker && lockChecker()) {
                logDebug('[HEALER:CANDIDATE] Failover lock active', {
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
                    currentSrc: result.vs.currentSrc,
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
                    Logger.add('[HEALER:CANDIDATE] Active video set', {
                        to: fallbackId,
                        reason: 'no_active',
                        scores
                    });
                    activeCandidateId = fallbackId;
                }
            }

            if (preferred && preferred.id !== activeCandidateId) {
                const activeState = current ? current.state : null;
                const activeIsStalled = !current || ['STALLED', 'RESET', 'ERROR', 'ENDED'].includes(activeState);

                if (!preferred.progressEligible) {
                    logDebug('[HEALER:CANDIDATE] Switch suppressed', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'preferred_not_progress_eligible',
                        activeState,
                        scores
                    });
                    return preferred;
                }

                if (!activeIsStalled) {
                    logDebug('[HEALER:CANDIDATE] Switch suppressed', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'active_not_stalled',
                        activeState,
                        scores
                    });
                    return preferred;
                }

                const currentTrusted = current ? current.trusted : false;
                if (currentTrusted && !preferred.trusted) {
                    logDebug('[HEALER:CANDIDATE] Switch blocked by trust', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        currentTrusted,
                        preferredTrusted: preferred.trusted,
                        scores
                    });
                    return preferred;
                }

                const decision = switchPolicy.shouldSwitch(current, preferred, scores, reason);
                if (decision.allow) {
                    Logger.add('[HEALER:CANDIDATE] Active video switched', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        delta: decision.delta,
                        currentScore: decision.currentScore,
                        bestScore: preferred.score,
                        bestProgressStreakMs: preferred.progressStreakMs,
                        bestProgressEligible: preferred.progressEligible,
                        scores
                    });
                    activeCandidateId = preferred.id;
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
                Logger.add('[HEALER:PRUNE] Stopped monitor due to cap', {
                    videoId: worst.id,
                    score: worst.score,
                    maxMonitors
                });
                stopMonitoring(worst.entry.video);
            } else {
                logDebug('[HEALER:PRUNE_SKIP] All candidates protected', {
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
            setLockChecker
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
                logDebug('[HEALER:BACKOFF] Reset', {
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

            Logger.add('[HEALER:BACKOFF] No heal point', {
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
                    logDebug('[HEALER:BACKOFF] Stall skipped due to backoff', {
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
            lastProbeTimes: new Map()
        };

        const resetFailover = (reason) => {
            if (state.timerId) {
                clearTimeout(state.timerId);
            }
            if (state.inProgress) {
                Logger.add('[HEALER:FAILOVER] Cleared', {
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
                logDebug('[HEALER:FAILOVER_SKIP] Failover already in progress', {
                    from: fromVideoId,
                    reason
                });
                return false;
            }
            if (now - state.lastAttemptTime < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
                logDebug('[HEALER:FAILOVER_SKIP] Failover cooldown active', {
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
                Logger.add('[HEALER:FAILOVER_SKIP] No trusted candidate available', {
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

            Logger.add('[HEALER:FAILOVER] Switching to candidate', {
                from: fromVideoId,
                to: toId,
                reason,
                stalledForMs: monitorState?.lastProgressTime ? (now - monitorState.lastProgressTime) : null,
                candidateState: VideoState.get(entry.video, toId)
            });

            const playPromise = entry.video?.play?.();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    Logger.add('[HEALER:FAILOVER_PLAY] Play rejected', {
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
                    Logger.add('[HEALER:FAILOVER_SUCCESS] Candidate progressed', {
                        from: fromVideoId,
                        to: toId,
                        progressDelayMs: latestProgressTime - state.startTime,
                        candidateState: VideoState.get(currentEntry.video, toId)
                    });
                    resetBackoff(currentEntry.monitor.state, 'failover_success');
                    state.recentFailures.delete(toId);
                } else {
                    Logger.add('[HEALER:FAILOVER_REVERT] Candidate did not progress', {
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
                    logDebug('[HEALER:FAILOVER] Stall ignored during failover', {
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

        return {
            isActive: () => state.inProgress,
            resetFailover,
            attemptFailover,
            probeCandidate: (videoId, reason) => {
                const entry = monitorsById.get(videoId);
                if (!entry) return false;
                const video = entry.video;
                if (!document.contains(video)) {
                    logDebug('[HEALER:PROBE_SKIP] Candidate not in DOM', {
                        videoId,
                        reason
                    });
                    return false;
                }

                const now = Date.now();
                const cooldownMs = CONFIG.monitoring.PROBE_COOLDOWN_MS;
                const lastProbeTime = state.lastProbeTimes.get(videoId) || 0;
                if (lastProbeTime > 0 && now - lastProbeTime < cooldownMs) {
                    logDebug('[HEALER:PROBE_SKIP] Probe cooldown active', {
                        videoId,
                        reason,
                        remainingMs: cooldownMs - (now - lastProbeTime)
                    });
                    return false;
                }

                const currentSrc = video.currentSrc || (video.getAttribute ? (video.getAttribute('src') || '') : '');
                const readyState = video.readyState;
                if (!currentSrc && readyState < 2) {
                    logDebug('[HEALER:PROBE_SKIP] Candidate not ready', {
                        videoId,
                        reason,
                        readyState
                    });
                    return false;
                }

                state.lastProbeTimes.set(videoId, now);
                Logger.add('[HEALER:PROBE] Probing candidate playback', {
                    videoId,
                    reason,
                    state: entry.monitor.state.state,
                    readyState,
                    hasSrc: Boolean(currentSrc)
                });
                const promise = video?.play?.();
                if (promise && typeof promise.catch === 'function') {
                    promise.catch((err) => {
                        Logger.add('[HEALER:PROBE_PLAY] Play rejected', {
                            videoId,
                            reason,
                            error: err?.name,
                            message: err?.message
                        });
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

        const backoffManager = BackoffManager.create({ logDebug });
        const failoverManager = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            resetBackoff: backoffManager.resetBackoff
        });
        const probeCandidate = failoverManager.probeCandidate;

        const handleNoHealPoint = (video, monitorState, reason) => {
            const videoId = getVideoId(video);
            backoffManager.applyBackoff(videoId, monitorState, reason);

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            if (shouldFailover) {
                failoverManager.attemptFailover(videoId, reason, monitorState);
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            if (failoverManager.shouldIgnoreStall(videoId)) {
                return true;
            }
            if (backoffManager.shouldSkip(videoId, monitorState)) {
                return true;
            }
            return false;
        };

        return {
            isFailoverActive: () => failoverManager.isActive(),
            resetFailover: failoverManager.resetFailover,
            resetBackoff: backoffManager.resetBackoff,
            handleNoHealPoint,
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
            Logger.add('[HEALER:STOP] Stopped monitoring video', {
                remainingMonitors: monitoredCount,
                videoId
            });
        };

        const monitor = (video) => {
            if (!video) return;

            if (!candidateSelector) {
                logDebug('[HEALER:SKIP] Candidate selector not ready');
                return;
            }

            if (monitoredVideos.has(video)) {
                logDebug('[HEALER:SKIP] Video already being monitored');
                return;
            }

            const videoId = getVideoId(video);
            Logger.add('[HEALER:VIDEO] Video registered', {
                videoId,
                videoState: VideoState.get(video, videoId)
            });

            const monitor = PlaybackMonitor.create(video, {
                isHealing,
                isActive: () => candidateSelector.getActiveId() === videoId,
                onRemoved: () => stopMonitoring(video),
                onStall: (details, state) => onStall(video, details, state),
                onReset: (details) => {
                    Logger.add('[HEALER:RESET] Video reset detected', {
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

            Logger.add('[HEALER:MONITOR] Started monitoring video', {
                videoId,
                debug: CONFIG.debug,
                checkInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                totalMonitors: monitoredCount
            });
        };

        return {
            monitor,
            stopMonitoring,
            getVideoId,
            bind,
            monitorsById,
            getMonitoredCount: () => monitoredCount
        };
    };

    return { create };
})();

// --- HealPointPoller ---
/**
 * Polls for heal points and detects self-recovery.
 */
const HealPointPoller = (() => {
    const LOG = {
        POLL_START: '[HEALER:POLL_START]',
        POLL_SUCCESS: '[HEALER:POLL_SUCCESS]',
        POLL_TIMEOUT: '[HEALER:POLL_TIMEOUT]',
        POLLING: '[HEALER:POLLING]',
        SELF_RECOVERED: '[HEALER:SELF_RECOVERED]'
    };

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

            logWithState(LOG.POLL_START, video, {
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
                    logWithState(LOG.SELF_RECOVERED, video, {
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
                    Logger.add(LOG.POLL_SUCCESS, {
                        attempts: pollCount,
                        type: healPoint.isNudge ? 'NUDGE' : 'GAP',
                        elapsed: (Date.now() - startTime) + 'ms',
                        healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        bufferSize: (healPoint.end - healPoint.start).toFixed(2) + 's'
                    });
                    return {
                        healPoint,
                        aborted: false
                    };
                }

                if (pollCount % 25 === 0) {
                    logDebug(LOG.POLLING, {
                        attempt: pollCount,
                        elapsed: (Date.now() - startTime) + 'ms',
                        buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    });
                }

                await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
            }

            Logger.add(LOG.POLL_TIMEOUT, {
                attempts: pollCount,
                elapsed: (Date.now() - startTime) + 'ms',
                finalState: VideoState.get(video, getVideoId(video))
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
    const LOG = {
        START: '[HEALER:START]'
    };

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

        const attemptHeal = async (video, monitorState) => {
            if (state.isHealing) {
                Logger.add('[HEALER:BLOCKED] Already healing');
                return;
            }

            if (!document.contains(video)) {
                Logger.add('[HEALER:DETACHED] Heal skipped, video not in DOM', {
                    reason: 'pre_heal',
                    videoId: getVideoId(video)
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

            logWithState(LOG.START, video, {
                attempt: state.healAttempts,
                lastProgressAgoMs: monitorState ? (Date.now() - monitorState.lastProgressTime) : undefined
            });

            try {
                const pollResult = await poller.pollForHealPoint(
                    video,
                    monitorState,
                    CONFIG.stall.HEAL_TIMEOUT_S * 1000
                );

                if (pollResult.aborted) {
                    Logger.add('[HEALER:DETACHED] Heal aborted during polling', {
                        reason: pollResult.reason || 'poll_abort',
                        videoId: getVideoId(video)
                    });
                    onDetached(video, pollResult.reason || 'poll_abort');
                    return;
                }

                const healPoint = pollResult.healPoint;
                if (!healPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        Logger.add('[HEALER:SKIPPED] Video recovered, no heal needed', {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                            finalState: VideoState.get(video, getVideoId(video))
                        });
                        recoveryManager.resetBackoff(monitorState, 'self_recovered');
                        return;
                    }

                    Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                        suggestion: 'User may need to refresh page',
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add('[HEALER:DETACHED] Heal aborted before revalidation', {
                        reason: 'pre_revalidate',
                        videoId: getVideoId(video)
                    });
                    onDetached(video, 'pre_revalidate');
                    return;
                }

                const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                if (!freshPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        Logger.add('[HEALER:STALE_RECOVERED] Heal point gone, but video recovered', {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms'
                        });
                        recoveryManager.resetBackoff(monitorState, 'stale_recovered');
                        return;
                    }
                    Logger.add('[HEALER:STALE_GONE] Heal point disappeared before seek', {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'stale_gone');
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add('[HEALER:DETACHED] Heal aborted before seek', {
                        reason: 'pre_seek',
                        videoId: getVideoId(video)
                    });
                    onDetached(video, 'pre_seek');
                    return;
                }

                const targetPoint = freshPoint;
                if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                    Logger.add('[HEALER:POINT_UPDATED] Using refreshed heal point', {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                        type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                    });
                }

                const result = await LiveEdgeSeeker.seekAndPlay(video, targetPoint);

                const duration = (performance.now() - healStartTime).toFixed(0);

                if (result.success) {
                    Logger.add('[HEALER:COMPLETE] Stream healed successfully', {
                        duration: duration + 'ms',
                        healAttempts: state.healAttempts,
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_successful');
                    recoveryManager.resetBackoff(monitorState, 'heal_success');
                } else {
                    Logger.add('[HEALER:FAILED] Heal attempt failed', {
                        duration: duration + 'ms',
                        error: result.error,
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                }
            } catch (e) {
                Logger.add('[HEALER:ERROR] Unexpected error during heal', {
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
            Logger.add('[HEALER:CANDIDATE_SNAPSHOT] Candidates scored', {
                reason,
                candidates
            });
        };

        const handleSignal = (signal = {}) => {
            if (!signal || monitorsById.size === 0) return;

            const type = signal.type || 'unknown';
            const level = signal.level || 'unknown';
            const message = signal.message || '';

            if (type === 'playhead_stall') {
                const attribution = playheadAttribution.resolve(signal.playheadSeconds);
                if (!attribution.id) {
                    Logger.add('[HEALER:STALL_HINT_UNATTRIBUTED] Console playhead stall warning', {
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

                Logger.add('[HEALER:STALL_HINT] Console playhead stall warning', {
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
                Logger.add('[HEALER:ASSET_HINT] Processing/offline asset detected', {
                    level,
                    message: truncateMessage(message)
                });

                logCandidateSnapshot('processing_asset');
                onRescan('processing_asset', { level, message: truncateMessage(message) });

                if (recoveryManager.isFailoverActive()) {
                    logDebug('[HEALER:ASSET_HINT_SKIP] Failover in progress', {
                        reason: 'processing_asset'
                    });
                    return;
                }

                const best = candidateSelector.evaluateCandidates('processing_asset');
                let activeId = candidateSelector.getActiveId();
                const activeEntry = activeId ? monitorsById.get(activeId) : null;
                const activeState = activeEntry ? activeEntry.monitor.state.state : null;
                const activeIsStalled = !activeEntry || ['STALLED', 'RESET', 'ERROR'].includes(activeState);

                if (best && best.id && activeId && best.id !== activeId && best.progressEligible && activeIsStalled) {
                    const fromId = activeId;
                    activeId = best.id;
                    candidateSelector.setActiveId(activeId);
                    Logger.add('[HEALER:CANDIDATE] Forced switch after processing asset', {
                        from: fromId,
                        to: activeId,
                        bestScore: best.score,
                        progressStreakMs: best.progressStreakMs,
                        progressEligible: best.progressEligible,
                        activeState
                    });
                } else if (best && best.id && best.id !== activeId) {
                    logDebug('[HEALER:CANDIDATE] Processing asset switch suppressed', {
                        from: activeId,
                        to: best.id,
                        progressEligible: best.progressEligible,
                        activeState
                    });
                    if (activeIsStalled) {
                        recoveryManager.probeCandidate(best.id, 'processing_asset');
                    }
                }

                const activeEntryForPlay = activeId ? monitorsById.get(activeId) : null;
                if (activeEntryForPlay) {
                    const playPromise = activeEntryForPlay.video?.play?.();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch((err) => {
                            Logger.add('[HEALER:ASSET_HINT_PLAY] Play rejected', {
                                videoId: activeId,
                                error: err?.name,
                                message: err?.message
                            });
                        });
                    }
                }
                return;
            }

            Logger.add('[HEALER:EXTERNAL] Unhandled external signal', {
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
        const recoveryManager = RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug
        });
        candidateSelector.setLockChecker(recoveryManager.isFailoverActive);
        monitorRegistry.bind({ candidateSelector, recoveryManager });

        const setStallHandler = (fn) => {
            stallHandler = typeof fn === 'function' ? fn : (() => {});
        };

        const scanForVideos = (reason, detail = {}) => {
            if (!document?.querySelectorAll) {
                return;
            }
            const beforeCount = monitorsById.size;
            const videos = Array.from(document.querySelectorAll('video'));
            Logger.add('[HEALER:SCAN] Video rescan requested', {
                reason,
                found: videos.length,
                ...detail
            });
            for (const video of videos) {
                const videoId = getVideoId(video);
                logDebug('[HEALER:SCAN_ITEM] Video discovered', {
                    reason,
                    videoId,
                    alreadyMonitored: monitorsById.has(videoId),
                    videoState: VideoState.get(video, videoId)
                });
            }
            for (const video of videos) {
                monitorRegistry.monitor(video);
            }
            candidateSelector.evaluateCandidates(`scan_${reason || 'manual'}`);
            candidateSelector.getActiveId();
            const afterCount = monitorsById.size;
            Logger.add('[HEALER:SCAN] Video rescan complete', {
                reason,
                found: videos.length,
                newMonitors: Math.max(afterCount - beforeCount, 0),
                totalMonitors: afterCount
            });
        };

        return {
            monitor: monitorRegistry.monitor,
            stopMonitoring: monitorRegistry.stopMonitoring,
            monitorsById,
            getVideoId,
            candidateSelector,
            recoveryManager,
            scanForVideos,
            setStallHandler,
            getMonitoredCount: () => monitorRegistry.getMonitoredCount()
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

        const onStallDetected = (video, details = {}, state = null) => {
            const now = Date.now();
            const videoId = getVideoId(video);

            if (recoveryManager.shouldSkipStall(videoId, state)) {
                return;
            }

            if (state) {
                const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
                if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                    logDebug('[HEALER:DEBOUNCE]', {
                        cooldownMs: CONFIG.stall.RETRY_COOLDOWN_MS,
                        lastHealAttemptAgoMs: now - state.lastHealAttemptTime,
                        state: state.state,
                        videoId
                    });
                    return;
                }
            }
            if (state) {
                state.lastHealAttemptTime = now;
            }

            candidateSelector.evaluateCandidates('stall');
            const activeCandidateId = candidateSelector.getActiveId();
            if (activeCandidateId && activeCandidateId !== videoId) {
                if (!state?.progressEligible) {
                    recoveryManager.probeCandidate(videoId, 'stall_non_active');
                }
                const lastLog = stallSkipLogTimes.get(videoId) || 0;
                const logIntervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
                if (now - lastLog >= logIntervalMs) {
                    stallSkipLogTimes.set(videoId, now);
                    logDebug('[HEALER:STALL_SKIP] Stall on non-active video', {
                        videoId,
                        activeVideoId: activeCandidateId,
                        stalledFor: details.stalledFor
                    });
                }
                return;
            }

            logWithState('[STALL:DETECTED]', video, {
                ...details,
                lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined,
                videoId
            });

            Metrics.increment('stalls_detected');
            healPipeline.attemptHeal(video, state);
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

    const logWithState = (message, video, detail = {}) => {
        Logger.add(message, {
            ...detail,
            videoState: VideoState.get(video, monitoring.getVideoId(video))
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

            exposeGlobal('getTwitchHealerStats', () => {
                return {
                    healer: StreamHealer.getStats(),
                    metrics: Metrics.getSummary()
                };
            });

            exposeGlobal('exportTwitchAdLogs', () => {
                const metricsSummary = Metrics.getSummary();
                const mergedLogs = Logger.getMergedTimeline();
                ReportGenerator.exportReport(metricsSummary, mergedLogs);
            });

            Logger.add('[CORE] Stream Healer ready', {
                config: {
                    watchdogInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                    healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
                }
            });
        }
    };
})();

CoreOrchestrator.init();

})();
