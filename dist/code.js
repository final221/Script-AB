// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       4.0.26
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
            MAX_VIDEO_MONITORS: 3,          // Max concurrent video elements to monitor
            CANDIDATE_SWITCH_DELTA: 2,      // Min score delta before switching active video
            CANDIDATE_MIN_PROGRESS_MS: 5000, // Require sustained progress before switching to new video
            PROGRESS_STREAK_RESET_MS: 2500, // Reset progress streak after this long without progress
        },

        logging: {
            LOG_CSP_WARNINGS: true,
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

// --- BufferGapFinder ---
/**
 * Finds "heal points" in the video buffer after a stall.
 * When uBO blocks ad segments, new content arrives in a separate buffer range.
 * This module finds that new range so we can seek to it.
 */
const BufferGapFinder = (() => {
    // Minimum buffer size to consider a valid heal point (seconds)
    const MIN_HEAL_BUFFER_S = 2;

    /**
     * Get all buffer ranges as an array of {start, end} objects
     */
    const getBufferRanges = (video) => {
        const ranges = [];
        if (!video?.buffered) return ranges;

        for (let i = 0; i < video.buffered.length; i++) {
            ranges.push({
                start: video.buffered.start(i),
                end: video.buffered.end(i)
            });
        }
        return ranges;
    };

    /**
     * Format buffer ranges for logging
     */
    const formatRanges = (ranges) => {
        if (!ranges || ranges.length === 0) return 'none';
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    /**
     * Find a heal point - a buffer range that starts AFTER currentTime
     * with sufficient buffer to be useful.
     * 
     * @param {HTMLVideoElement} video
     * @param {Object} options
     * @param {boolean} options.silent - If true, suppress logging (for polling loops)
     * @returns {{ start: number, end: number, gapSize: number } | null}
     */
    const findHealPoint = (video, options = {}) => {
        if (!video) {
            if (!options.silent) {
                Logger.add('[HEALER:ERROR] No video element');
            }
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = getBufferRanges(video);

        if (!options.silent) {
            Logger.add('[HEALER:SCAN] Scanning for heal point', {
                currentTime: currentTime.toFixed(3),
                bufferRanges: formatRanges(ranges),
                rangeCount: ranges.length
            });
        }

        // Look for a buffer range that offers enough content ahead
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];

            // Check if this range has enough content AFTER the current time
            // (end - max(start, currentTime)) > MIN
            const effectiveStart = Math.max(range.start, currentTime);
            const contentAhead = range.end - effectiveStart;

            if (contentAhead > MIN_HEAL_BUFFER_S) {
                // Determine if this is a gap jump or a contiguous nudge
                let healStart = range.start;
                let isNudge = false;

                if (range.start <= currentTime) {
                    // Contiguous buffer: Nudge forward to unstuck
                    healStart = currentTime + 0.5;
                    isNudge = true;

                    // SAFETY: Ensure we don't nudge past the end (though contentAhead check covers this)
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
                ranges: formatRanges(ranges),
                minRequired: MIN_HEAL_BUFFER_S + 's'
            });
        }

        return null;
    };

    /**
     * Check if we're at buffer exhaustion (stalled because buffer ran out)
     */
    const isBufferExhausted = (video) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return true; // No buffer at all
        }

        const currentTime = video.currentTime;

        // Find which buffer range contains currentTime
        for (let i = 0; i < video.buffered.length; i++) {
            const start = video.buffered.start(i);
            const end = video.buffered.end(i);

            if (currentTime >= start && currentTime <= end) {
                // We're in this range - check if we're at the edge
                const bufferRemaining = end - currentTime;
                const exhausted = bufferRemaining < 0.5; // Less than 0.5s remaining

                return exhausted;
            }
        }

        // Not in any buffer range - we've fallen off
        return true;
    };

    return {
        findHealPoint,
        isBufferExhausted,
        getBufferRanges,
        formatRanges,
        MIN_HEAL_BUFFER_S
    };
})();

// --- LiveEdgeSeeker ---
/**
 * Seeks to a heal point and resumes playback.
 * CRITICAL: Validates seek target is within buffer bounds to avoid Infinity duration.
 */
const LiveEdgeSeeker = (() => {
    /**
     * Validate that a seek target is safe (within buffer bounds)
     */
    const validateSeekTarget = (video, target) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return { valid: false, reason: 'No buffer' };
        }

        // Check if target is within any buffer range
        for (let i = 0; i < video.buffered.length; i++) {
            const start = video.buffered.start(i);
            const end = video.buffered.end(i);

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

    /**
     * Calculate safe seek target within a heal point range
     * Seeks to just after start, but never beyond end
     */
    const calculateSafeTarget = (healPoint) => {
        const { start, end } = healPoint;
        const bufferSize = end - start;

        // Seek to 0.1s after start, or middle of tiny buffers
        if (bufferSize < 1) {
            return start + (bufferSize * 0.5); // Middle of small buffer
        }

        // For larger buffers, seek to 0.5s in (but ensure at least 1s headroom)
        const offset = Math.min(0.5, bufferSize - 1);
        return start + offset;
    };

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
        const target = calculateSafeTarget(healPoint);

        // Validate before seeking
        const validation = validateSeekTarget(video, target);

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
            await Fn.sleep(100);

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
                await Fn.sleep(200);

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
        validateSeekTarget,
        calculateSafeTarget
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
    const MAX_LOGS = 5000;
    const MAX_CONSOLE_LOGS = 2000;

    /**
     * Add an internal log entry.
     * @param {string} message - Log message (use prefixes like [HEALER:*], [CORE:*])
     * @param {Object|null} detail - Optional structured data
     */
    const add = (message, detail = null) => {
        if (logs.length >= MAX_LOGS) logs.shift();
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
        if (consoleLogs.length >= MAX_CONSOLE_LOGS) consoleLogs.shift();

        let message;
        try {
            message = args.map(arg => {
                if (typeof arg === 'string') return arg;
                if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                try { return JSON.stringify(arg); } catch { return String(arg); }
            }).join(' ');

            if (message.length > 500) {
                message = message.substring(0, 500) + '... [truncated]';
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

// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior.
 * Streamlined: Captures console output for debugging timeline, no recovery triggering.
 * Recovery is now handled entirely by StreamHealer.monitor().
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;
    const SIGNAL_THROTTLE_MS = 2000;
    const SIGNAL_PATTERNS = {
        PLAYHEAD_STALL: /playhead stalling at/i,
        PROCESSING_ASSET: /404_processing_640x360\.png/i,
    };
    const lastSignalTimes = {
        playhead_stall: 0,
        processing_asset: 0
    };
    let externalSignalHandler = null;

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
                reason: event.reason ? String(event.reason).substring(0, 200) : 'Unknown',
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

    const maybeEmitSignal = (type, message, level) => {
        const now = Date.now();
        const lastTime = lastSignalTimes[type] || 0;
        if (now - lastTime < SIGNAL_THROTTLE_MS) {
            return;
        }
        lastSignalTimes[type] = now;
        Logger.add('[INSTRUMENT:CONSOLE_HINT] Console signal detected', {
            type,
            level,
            message: message.substring(0, 300)
        });
        emitExternalSignal({
            type,
            level,
            message,
            timestamp: new Date().toISOString()
        });
    };

    const detectConsoleSignals = (level, message) => {
        if (SIGNAL_PATTERNS.PLAYHEAD_STALL.test(message)) {
            maybeEmitSignal('playhead_stall', message, level);
        }
        if (SIGNAL_PATTERNS.PROCESSING_ASSET.test(message)) {
            maybeEmitSignal('processing_asset', message, level);
        }
    };

    // Capture console.log for timeline correlation
    const interceptConsoleLog = () => {
        const originalLog = console.log;

        console.log = (...args) => {
            originalLog.apply(console, args);
            try {
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
                Logger.captureConsole('error', args);

                const msg = args.map(String).join(' ');
                const classification = classifyError(null, msg);

                Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                    message: msg.substring(0, 300),
                    severity: classification.severity,
                    action: classification.action
                });

                detectConsoleSignals('error', msg);

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

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                Logger.captureConsole('warn', args);

                const msg = args.map(String).join(' ');

                detectConsoleSignals('warn', msg);

                // Log CSP warnings for debugging
                if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
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
        init: (options = {}) => {
            externalSignalHandler = typeof options.onSignal === 'function'
                ? options.onSignal
                : null;
            Logger.add('[INSTRUMENT:INIT] Instrumentation initialized', {
                features: ['globalErrors', 'consoleLogs', 'consoleErrors', 'consoleWarns'],
                consoleCapture: true,
                externalSignals: Boolean(externalSignalHandler)
            });
            setupGlobalErrorHandlers();
            interceptConsoleLog();
            interceptConsoleError();
            interceptConsoleWarn();
        },
    };
})();

// --- VideoState ---
/**
 * Shared helper for consistent video state logging.
 */
const VideoState = (() => {
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
        }
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
            noHealPointCount: 0,
            nextHealAllowedTime: 0,
            lastBackoffLogTime: 0,
            lastInitLogTime: 0,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0,
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
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
            if (vs.currentSrc || vs.src || vs.readyState !== 0) {
                return;
            }

            state.state = 'RESET';
            logDebug('[HEALER:RESET] Video reset', {
                reason,
                videoState: vs
            });
            onReset({ reason, videoState: vs }, state);
        };

        const shouldSkipUntilProgress = () => {
            const now = Date.now();
            if (!state.hasProgress) {
                if (now - state.lastInitLogTime > 5000) {
                    state.lastInitLogTime = now;
                    logDebug('[HEALER:WATCHDOG] Awaiting initial progress', {
                        state: state.state,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                return true;
            }
            return false;
        };

        return {
            state,
            updateProgress,
            markStallEvent,
            handleReset,
            shouldSkipUntilProgress
        };
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
        STATE: '[HEALER:STATE]',
        EVENT: '[HEALER:EVENT]',
        WATCHDOG: '[HEALER:WATCHDOG]'
    };

    const create = (video, options = {}) => {
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});
        const onRemoved = options.onRemoved || (() => {});
        const onReset = options.onReset || (() => {});
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

        let intervalId;

        const start = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor started', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            Object.entries(handlers).forEach(([event, handler]) => {
                video.addEventListener(event, handler);
            });

            intervalId = setInterval(() => {
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

                const stalledForMs = now - state.lastProgressTime;
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

                if (now - state.lastWatchdogLogTime > 5000) {
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
            }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stop = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor stopped', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            if (intervalId !== undefined) {
                clearInterval(intervalId);
            }

            Object.entries(handlers).forEach(([event, handler]) => {
                video.removeEventListener(event, handler);
            });
        };

        return {
            start,
            stop,
            state
        };
    };

    return { create };
})();

// --- CandidateSelector ---
/**
 * Scores and selects the best video candidate for healing.
 */
const CandidateSelector = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;
        const maxMonitors = options.maxMonitors;
        const minProgressMs = options.minProgressMs;
        const switchDelta = options.switchDelta;
        const isFallbackSource = options.isFallbackSource;

        let activeCandidateId = null;
        let lockChecker = null;

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const getActiveId = () => activeCandidateId;
        const setActiveId = (id) => {
            activeCandidateId = id;
        };

        const scoreVideo = (video, monitor, videoId) => {
            const vs = VideoState.get(video, videoId);
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
            } else if (progressAgoMs < 2000) {
                score += 3;
                reasons.push('recent_progress');
            } else if (progressAgoMs < 5000) {
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

            if (vs.buffered !== 'none') {
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
                return null;
            }

            let best = null;
            let current = null;
            const scores = [];

            if (activeCandidateId && monitorsById.has(activeCandidateId)) {
                const entry = monitorsById.get(activeCandidateId);
                current = { id: activeCandidateId, ...scoreVideo(entry.video, entry.monitor, activeCandidateId) };
            }

            for (const [videoId, entry] of monitorsById.entries()) {
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                scores.push({
                    id: videoId,
                    score: result.score,
                    progressAgoMs: result.progressAgoMs,
                    progressStreakMs: result.progressStreakMs,
                    progressEligible: result.progressEligible,
                    paused: result.vs.paused,
                    readyState: result.vs.readyState,
                    currentSrc: result.vs.currentSrc,
                    reasons: result.reasons
                });

                if (!best || result.score > best.score) {
                    best = { id: videoId, ...result };
                }
            }

            if (best && best.id !== activeCandidateId) {
                let allowSwitch = true;
                let delta = null;
                let currentScore = null;
                let suppression = null;

                if (current) {
                    delta = best.score - current.score;
                    currentScore = current.score;
                    const currentBad = current.reasons.includes('fallback_src')
                        || current.reasons.includes('ended')
                        || current.reasons.includes('not_in_dom')
                        || current.reasons.includes('reset')
                        || current.reasons.includes('error_state');
                    if (!best.progressEligible && !currentBad) {
                        allowSwitch = false;
                        suppression = 'insufficient_progress';
                    } else if (!currentBad && delta < switchDelta) {
                        allowSwitch = false;
                        suppression = 'score_delta';
                    }
                }

                if (!allowSwitch) {
                    logDebug('[HEALER:CANDIDATE] Switch suppressed', {
                        from: activeCandidateId,
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

                if (allowSwitch) {
                    Logger.add('[HEALER:CANDIDATE] Active video switched', {
                        from: activeCandidateId,
                        to: best.id,
                        reason,
                        delta,
                        currentScore,
                        bestScore: best.score,
                        bestProgressStreakMs: best.progressStreakMs,
                        bestProgressEligible: best.progressEligible,
                        scores
                    });
                    activeCandidateId = best.id;
                }
            }

            return best;
        };

        const pruneMonitors = (excludeId, stopMonitoring) => {
            if (monitorsById.size <= maxMonitors) return;

            let worst = null;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
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

// --- RecoveryManager ---
/**
 * Handles backoff and failover recovery strategies.
 */
const RecoveryManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;

        const state = {
            inProgress: false,
            timerId: null,
            lastAttemptTime: 0,
            fromId: null,
            toId: null,
            startTime: 0,
            baselineProgressTime: 0
        };

        const getVideoIndex = (videoId) => {
            const match = /video-(\d+)/.exec(videoId);
            return match ? Number(match[1]) : -1;
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

        const selectNewestCandidate = (excludeId) => {
            let newest = null;
            let newestIndex = -1;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                const idx = getVideoIndex(videoId);
                if (idx > newestIndex) {
                    newestIndex = idx;
                    newest = { id: videoId, entry };
                }
            }
            return newest;
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

            const candidate = selectNewestCandidate(fromVideoId);
            if (!candidate) {
                logDebug('[HEALER:FAILOVER_SKIP] No candidate available', {
                    from: fromVideoId,
                    reason
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
                } else {
                    Logger.add('[HEALER:FAILOVER_REVERT] Candidate did not progress', {
                        from: fromVideoId,
                        to: toId,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS,
                        progressObserved: Boolean(currentEntry?.monitor.state.hasProgress),
                        candidateState: currentEntry ? VideoState.get(currentEntry.video, toId) : null
                    });
                    if (fromEntry) {
                        candidateSelector.setActiveId(fromVideoId);
                    }
                }

                resetFailover('timeout');
            }, CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS);

            return true;
        };

        const handleNoHealPoint = (video, monitorState, reason) => {
            const videoId = getVideoId(video);
            applyBackoff(videoId, monitorState, reason);

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            if (shouldFailover) {
                attemptFailover(videoId, reason, monitorState);
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            const now = Date.now();
            if (state.inProgress && state.toId === videoId) {
                const elapsedMs = now - state.startTime;
                if (elapsedMs < CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS) {
                    logDebug('[HEALER:FAILOVER] Stall ignored during failover', {
                        videoId,
                        elapsedMs,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS
                    });
                    return true;
                }
            }

            if (monitorState?.nextHealAllowedTime && now < monitorState.nextHealAllowedTime) {
                if (now - (monitorState.lastBackoffLogTime || 0) > 5000) {
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

        const onMonitorRemoved = (videoId) => {
            if (state.inProgress && (videoId === state.toId || videoId === state.fromId)) {
                resetFailover('monitor_removed');
            }
        };

        return {
            isFailoverActive: () => state.inProgress,
            resetFailover,
            resetBackoff,
            handleNoHealPoint,
            shouldSkipStall,
            onMonitorRemoved
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
    let isHealing = false;
    let healAttempts = 0;
    let monitoredCount = 0; // Track count manually (WeakMap has no .size)

    // Track monitored videos to prevent duplicate monitors
    const monitoredVideos = new WeakMap(); // video -> monitor
    const monitorsById = new Map(); // videoId -> { video, monitor }
    const videoIds = new WeakMap();
    let nextVideoId = 1;
    let candidateIntervalId = null;
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;

    const LOG = {
        POLL_START: '[HEALER:POLL_START]',
        POLL_SUCCESS: '[HEALER:POLL_SUCCESS]',
        POLL_TIMEOUT: '[HEALER:POLL_TIMEOUT]',
        POLLING: '[HEALER:POLLING]',
        SELF_RECOVERED: '[HEALER:SELF_RECOVERED]',
        START: '[HEALER:START]',
        DEBOUNCE: '[HEALER:DEBOUNCE]',
        STALL_DETECTED: '[STALL:DETECTED]'
    };

    const logDebug = (message, detail) => {
        if (CONFIG.debug) {
            Logger.add(message, detail);
        }
    };

    const getVideoId = (video) => {
        let id = videoIds.get(video);
        if (!id) {
            id = `video-${nextVideoId++}`;
            videoIds.set(video, id);
        }
        return id;
    };

    const logWithState = (message, video, detail = {}) => {
        Logger.add(message, {
            ...detail,
            videoState: VideoState.get(video, getVideoId(video))
        });
    };

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);
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

    const startCandidateEvaluation = () => {
        if (candidateIntervalId) return;
        candidateIntervalId = setInterval(() => {
            candidateSelector.evaluateCandidates('interval');
        }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
    };

    const stopCandidateEvaluationIfIdle = () => {
        if (monitorsById.size === 0 && candidateIntervalId) {
            clearInterval(candidateIntervalId);
            candidateIntervalId = null;
            candidateSelector.setActiveId(null);
        }
    };

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

    /**
     * Check if video has recovered (recent progress observed)
     */
    const hasRecovered = (video, state) => {
        if (!video || !state) return false;
        return Date.now() - state.lastProgressTime < CONFIG.stall.RECOVERY_WINDOW_MS;
    };

    /**
     * Poll for a heal point with timeout
     * Includes early abort if video self-recovers
     */
    const pollForHealPoint = async (video, state, timeoutMs) => {
        const startTime = Date.now();
        let pollCount = 0;

        logWithState(LOG.POLL_START, video, {
            timeout: timeoutMs + 'ms'
        });

        while (Date.now() - startTime < timeoutMs) {
            pollCount++;

            // Early abort: Check if video recovered on its own
            if (hasRecovered(video, state)) {
                logWithState(LOG.SELF_RECOVERED, video, {
                    pollCount,
                    elapsed: (Date.now() - startTime) + 'ms'
                });
                return null; // No need to heal - already playing
            }

            // Use silent mode during polling to reduce log spam
            const healPoint = BufferGapFinder.findHealPoint(video, { silent: true });

            if (healPoint) {
                Logger.add(LOG.POLL_SUCCESS, {
                    attempts: pollCount,
                    type: healPoint.isNudge ? 'NUDGE' : 'GAP',
                    elapsed: (Date.now() - startTime) + 'ms',
                    healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    bufferSize: (healPoint.end - healPoint.start).toFixed(2) + 's'
                });
                return healPoint;
            }

            // Log progress every 25 polls (~5 seconds)
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

        return null;
    };

    /**
     * Main heal attempt
     */
    const attemptHeal = async (video, state) => {
        if (isHealing) {
            Logger.add('[HEALER:BLOCKED] Already healing');
            return;
        }

        isHealing = true;
        healAttempts++;
        const healStartTime = performance.now();
        if (state) {
            state.state = 'HEALING';
            state.lastHealAttemptTime = Date.now();
        }

        logWithState(LOG.START, video, {
            attempt: healAttempts,
            lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined
        });

        try {
            // Step 1: Poll for heal point
            const healPoint = await pollForHealPoint(video, state, CONFIG.stall.HEAL_TIMEOUT_S * 1000);

            // Check if we got null due to self-recovery (not timeout)
            if (!healPoint) {
                if (hasRecovered(video, state)) {
                    Logger.add('[HEALER:SKIPPED] Video recovered, no heal needed', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    recoveryManager.resetBackoff(state, 'self_recovered');
                    // Don't count as failed - video is fine
                    return;
                }

                Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                    duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                    suggestion: 'User may need to refresh page',
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, state, 'no_heal_point');
                return;
            }

            // Step 2: Re-validate heal point is still fresh before seeking
            const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
            if (!freshPoint) {
                // No heal point anymore - check if video recovered
                if (hasRecovered(video, state)) {
                    Logger.add('[HEALER:STALE_RECOVERED] Heal point gone, but video recovered', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms'
                    });
                    recoveryManager.resetBackoff(state, 'stale_recovered');
                    return;
                }
                Logger.add('[HEALER:STALE_GONE] Heal point disappeared before seek', {
                    original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, state, 'stale_gone');
                return;
            }

            // Use fresh point if it's different (buffer may have grown)
            const targetPoint = freshPoint;
            if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                Logger.add('[HEALER:POINT_UPDATED] Using refreshed heal point', {
                    original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                    type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                });
            }

            // Step 3: Seek to heal point and play
            const result = await LiveEdgeSeeker.seekAndPlay(video, targetPoint);

            const duration = (performance.now() - healStartTime).toFixed(0);

            if (result.success) {
                Logger.add('[HEALER:COMPLETE] Stream healed successfully', {
                    duration: duration + 'ms',
                    healAttempts,
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_successful');
                recoveryManager.resetBackoff(state, 'heal_success');
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
            isHealing = false;
            if (state) {
                if (video.paused) {
                    state.state = 'PAUSED';
                } else if (hasRecovered(video, state)) {
                    state.state = 'PLAYING';
                } else {
                    state.state = 'STALLED';
                }
            }
        }
    };

    /**
     * Handle stall detection event
     */
    const onStallDetected = (video, details = {}, state = null) => {
        const now = Date.now();
        const videoId = getVideoId(video);

        if (recoveryManager.shouldSkipStall(videoId, state)) {
            return;
        }

        if (state) {
            const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
            if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                logDebug(LOG.DEBOUNCE, {
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
            logDebug('[HEALER:STALL_SKIP] Stall on non-active video', {
                videoId,
                activeVideoId: activeCandidateId,
                stalledFor: details.stalledFor
            });
            return;
        }

        logWithState(LOG.STALL_DETECTED, video, {
            ...details,
            lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined,
            videoId
        });

        Metrics.increment('stalls_detected');
        attemptHeal(video, state);
    };

    const handleExternalSignal = (signal = {}) => {
        if (!signal || monitorsById.size === 0) return;

        const type = signal.type || 'unknown';
        const level = signal.level || 'unknown';
        const message = signal.message || '';

        if (type === 'playhead_stall') {
            const active = getActiveEntry();
            if (!active) return;
            const now = Date.now();
            const state = active.entry.monitor.state;
            state.lastStallEventTime = now;
            state.pauseFromStall = true;

            Logger.add('[HEALER:STALL_HINT] Console playhead stall warning', {
                videoId: active.id,
                level,
                message: message.substring(0, 300),
                lastProgressAgoMs: state.lastProgressTime ? (now - state.lastProgressTime) : null,
                videoState: VideoState.get(active.entry.video, active.id)
            });

            if (!state.hasProgress || !state.lastProgressTime) {
                return;
            }

            const stalledForMs = now - state.lastProgressTime;
            if (stalledForMs >= CONFIG.stall.STALL_CONFIRM_MS) {
                onStallDetected(active.entry.video, {
                    trigger: 'CONSOLE_STALL',
                    stalledFor: stalledForMs + 'ms',
                    bufferExhausted: BufferGapFinder.isBufferExhausted(active.entry.video),
                    paused: active.entry.video.paused,
                    pauseFromStall: true
                }, state);
            }
            return;
        }

        if (type === 'processing_asset') {
            Logger.add('[HEALER:ASSET_HINT] Processing/offline asset detected', {
                level,
                message: message.substring(0, 300)
            });

            logCandidateSnapshot('processing_asset');

            if (recoveryManager.isFailoverActive()) {
                logDebug('[HEALER:ASSET_HINT_SKIP] Failover in progress', {
                    reason: 'processing_asset'
                });
                return;
            }

            const best = candidateSelector.evaluateCandidates('processing_asset');
            let activeId = candidateSelector.getActiveId();

            if (best && best.id && activeId && best.id !== activeId && best.progressEligible) {
                const fromId = activeId;
                activeId = best.id;
                candidateSelector.setActiveId(activeId);
                Logger.add('[HEALER:CANDIDATE] Forced switch after processing asset', {
                    from: fromId,
                    to: activeId,
                    bestScore: best.score,
                    progressStreakMs: best.progressStreakMs,
                    progressEligible: best.progressEligible
                });
            }

            const activeEntry = activeId ? monitorsById.get(activeId) : null;
            if (activeEntry) {
                const playPromise = activeEntry.video?.play?.();
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
            message: message.substring(0, 300)
        });
    };

    /**
     * Stop monitoring a specific video
     */
    const stopMonitoring = (video) => {
        const monitor = monitoredVideos.get(video);
        if (!monitor) return;

        monitor.stop();
        monitoredVideos.delete(video);
        const videoId = getVideoId(video);
        monitorsById.delete(videoId);
        monitoredCount--;
        recoveryManager.onMonitorRemoved(videoId);
        if (candidateSelector.getActiveId() === videoId) {
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

    /**
     * Start monitoring a video element
     */
    const monitor = (video) => {
        if (!video) return;

        // Prevent duplicate monitoring of the same video
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
            isHealing: () => isHealing,
            onRemoved: () => stopMonitoring(video),
            onStall: (details, state) => onStallDetected(video, details, state),
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

        // Track this video monitor
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
        onStallDetected,
        attemptHeal,
        handleExternalSignal,
        getStats: () => ({ healAttempts, isHealing, monitoredCount })
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
                // Find video element and start StreamHealer
                const findAndMonitorVideo = (targetNode) => {
                    // If targetNode is provided, use it. Otherwise search document.
                    // But critical: only monitor if it is/contains a video
                    let video = null;

                    if (targetNode) {
                        if (targetNode.nodeName === 'VIDEO') {
                            video = targetNode;
                        } else if (targetNode.querySelector) {
                            video = targetNode.querySelector('video');
                        }
                    } else {
                        video = document.querySelector('video');
                    }

                    if (video) {
                        Logger.add('[CORE] New video detected in DOM');
                        Logger.add('[CORE] Video element found, starting StreamHealer');
                        StreamHealer.monitor(video);
                    }
                };

                // Try immediately (initial page load)
                findAndMonitorVideo();

                // Also observe for new videos
                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            // Only check relevant nodes
                            if (node.nodeName === 'VIDEO' ||
                                (node.nodeName === 'DIV' && node.querySelector && node.querySelector('video'))) {
                                // Pass the specific node to avoid global lookup of existing video
                                findAndMonitorVideo(node);
                            }
                        }
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                Logger.add('[CORE] DOM observer started');
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
