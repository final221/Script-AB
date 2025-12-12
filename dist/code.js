// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       4.0.5
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
        // StreamHealer configuration
        stall: {
            DETECTION_INTERVAL_MS: 500,     // How often to check for stalls
            STUCK_COUNT_TRIGGER: 4,         // Consecutive stuck checks before triggering (4 * 500ms = 2s)
            HEAL_POLL_INTERVAL_MS: 200,     // How often to poll for heal point
            HEAL_TIMEOUT_S: 15,             // Give up after this many seconds
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

// --- BufferGapFinder ---
/**
 * Finds "heal points" in the video buffer after a stall.
 * When uBO blocks ad segments, new content arrives in a separate buffer range.
 * This module finds that new range so we can seek to it.
 */
const BufferGapFinder = (() => {
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
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    /**
     * Find a heal point - a buffer range that starts AFTER currentTime
     * This is where new content is buffering after a gap
     * 
     * @param {HTMLVideoElement} video
     * @returns {{ start: number, end: number } | null}
     */
    const findHealPoint = (video) => {
        if (!video) {
            Logger.add('[HEALER:ERROR] No video element');
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = getBufferRanges(video);

        Logger.add('[HEALER:SCAN] Scanning for heal point', {
            currentTime: currentTime.toFixed(3),
            bufferRanges: formatRanges(ranges),
            rangeCount: ranges.length
        });

        // Look for a buffer range that starts ahead of current position
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];

            // Found a range starting after current position (with small gap tolerance)
            if (range.start > currentTime + 0.5) {
                const healPoint = {
                    start: range.start,
                    end: range.end,
                    gapSize: range.start - currentTime
                };

                Logger.add('[HEALER:FOUND] Heal point identified', {
                    healPoint: `${range.start.toFixed(3)}-${range.end.toFixed(3)}`,
                    gapSize: healPoint.gapSize.toFixed(2) + 's',
                    bufferSize: (range.end - range.start).toFixed(2) + 's'
                });

                return healPoint;
            }
        }

        Logger.add('[HEALER:NONE] No heal point found yet', {
            currentTime: currentTime.toFixed(3),
            ranges: formatRanges(ranges)
        });

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

                if (exhausted) {
                    Logger.add('[HEALER:EXHAUSTED] Buffer exhausted', {
                        currentTime: currentTime.toFixed(3),
                        bufferEnd: end.toFixed(3),
                        remaining: bufferRemaining.toFixed(3) + 's'
                    });
                }

                return exhausted;
            }
        }

        // Not in any buffer range - we've fallen off
        Logger.add('[HEALER:GAP] Current time not in any buffer range', {
            currentTime: currentTime.toFixed(3)
        });
        return true;
    };

    return {
        findHealPoint,
        isBufferExhausted,
        getBufferRanges,
        formatRanges
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

            if (target >= start && target < end) {
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

// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    let isHealing = false;
    let healAttempts = 0;
    let lastStallTime = 0;

    /**
     * Get current video state for logging
     */
    const getVideoState = (video) => {
        if (!video) return { error: 'NO_VIDEO' };
        return {
            currentTime: video.currentTime?.toFixed(3),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
        };
    };

    /**
     * Check if video is currently stalled (not progressing)
     */
    const isStalled = (video) => {
        if (!video) return false;

        // Must be paused or not making progress
        if (!video.paused && video.readyState >= 3) {
            return false; // Playing fine
        }

        // Check if buffer is exhausted
        return BufferGapFinder.isBufferExhausted(video);
    };

    /**
     * Poll for a heal point with timeout
     */
    const pollForHealPoint = async (video, timeoutMs) => {
        const startTime = Date.now();
        let pollCount = 0;

        Logger.add('[HEALER:POLL_START] Polling for heal point', {
            timeout: timeoutMs + 'ms',
            videoState: getVideoState(video)
        });

        while (Date.now() - startTime < timeoutMs) {
            pollCount++;

            const healPoint = BufferGapFinder.findHealPoint(video);

            if (healPoint) {
                Logger.add('[HEALER:POLL_SUCCESS] Heal point found', {
                    attempts: pollCount,
                    elapsed: (Date.now() - startTime) + 'ms',
                    healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`
                });
                return healPoint;
            }

            // Log progress every 10 polls
            if (pollCount % 10 === 0) {
                Logger.add('[HEALER:POLLING]', {
                    attempt: pollCount,
                    elapsed: (Date.now() - startTime) + 'ms',
                    buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                });
            }

            await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
        }

        Logger.add('[HEALER:POLL_TIMEOUT] No heal point found within timeout', {
            attempts: pollCount,
            elapsed: (Date.now() - startTime) + 'ms',
            finalState: getVideoState(video)
        });

        return null;
    };

    /**
     * Main heal attempt
     */
    const attemptHeal = async (video) => {
        if (isHealing) {
            Logger.add('[HEALER:BLOCKED] Already healing');
            return;
        }

        isHealing = true;
        healAttempts++;
        const healStartTime = performance.now();

        Logger.add('[HEALER:START] Beginning heal attempt', {
            attempt: healAttempts,
            videoState: getVideoState(video)
        });

        try {
            // Step 1: Poll for heal point
            const healPoint = await pollForHealPoint(video, CONFIG.stall.HEAL_TIMEOUT_S * 1000);

            if (!healPoint) {
                Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                    duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                    suggestion: 'User may need to refresh page',
                    finalState: getVideoState(video)
                });
                return;
            }

            // Step 2: Seek to heal point and play
            const result = await LiveEdgeSeeker.seekAndPlay(video, healPoint);

            const duration = (performance.now() - healStartTime).toFixed(0);

            if (result.success) {
                Logger.add('[HEALER:COMPLETE] Stream healed successfully', {
                    duration: duration + 'ms',
                    healAttempts,
                    finalState: getVideoState(video)
                });
                Metrics.increment('heals_successful');
            } else {
                Logger.add('[HEALER:FAILED] Heal attempt failed', {
                    duration: duration + 'ms',
                    error: result.error,
                    finalState: getVideoState(video)
                });
                Metrics.increment('heals_failed');
            }
        } catch (e) {
            Logger.add('[HEALER:ERROR] Unexpected error during heal', {
                error: e.name,
                message: e.message,
                stack: e.stack?.split('\n')[0]
            });
        } finally {
            isHealing = false;
        }
    };

    /**
     * Handle stall detection event
     */
    const onStallDetected = (video, details = {}) => {
        const now = Date.now();

        // Debounce rapid stall events
        if (now - lastStallTime < 5000) {
            Logger.add('[HEALER:DEBOUNCE] Ignoring rapid stall event');
            return;
        }
        lastStallTime = now;

        Logger.add('[STALL:DETECTED] Stall detected, initiating heal', {
            ...details,
            videoState: getVideoState(video)
        });

        Metrics.increment('stalls_detected');
        attemptHeal(video);
    };

    /**
     * Start monitoring a video element
     */
    const monitor = (video) => {
        if (!video) return;

        let lastTime = video.currentTime;
        let stuckCount = 0;

        const checkInterval = setInterval(() => {
            if (!document.contains(video)) {
                Logger.add('[HEALER:CLEANUP] Video removed from DOM');
                clearInterval(checkInterval);
                return;
            }

            const currentTime = video.currentTime;
            const moved = Math.abs(currentTime - lastTime) > 0.1;

            if (!video.paused && !moved && video.readyState < 4) {
                stuckCount++;

                if (stuckCount >= CONFIG.stall.STUCK_COUNT_TRIGGER) {
                    onStallDetected(video, {
                        stuckCount,
                        trigger: 'STUCK_MONITOR'
                    });
                    stuckCount = 0; // Reset after triggering
                }
            } else {
                stuckCount = 0;
            }

            lastTime = currentTime;
        }, CONFIG.stall.DETECTION_INTERVAL_MS);

        Logger.add('[HEALER:MONITOR] Started monitoring video', {
            checkInterval: CONFIG.stall.DETECTION_INTERVAL_MS + 'ms'
        });
    };

    return {
        monitor,
        onStallDetected,
        attemptHeal,
        getStats: () => ({ healAttempts, isHealing })
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
            Instrumentation.init();  // Console capture for debugging

            // Wait for DOM then start monitoring
            const startMonitoring = () => {
                // Find video element and start StreamHealer
                const findAndMonitorVideo = () => {
                    const video = document.querySelector('video');
                    if (video) {
                        Logger.add('[CORE] Video element found, starting StreamHealer');
                        StreamHealer.monitor(video);
                    }
                };

                // Try immediately
                findAndMonitorVideo();

                // Also observe for new videos
                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeName === 'VIDEO' ||
                                (node.querySelector && node.querySelector('video'))) {
                                Logger.add('[CORE] New video detected in DOM');
                                findAndMonitorVideo();
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

            // Expose debug functions
            window.forceTwitchHeal = () => {
                const video = document.querySelector('video');
                if (video) {
                    Logger.add('[CORE] Manual heal triggered');
                    StreamHealer.onStallDetected(video, { trigger: 'MANUAL' });
                } else {
                    console.log('No video element found');
                }
            };

            window.getTwitchHealerStats = () => {
                return {
                    healer: StreamHealer.getStats(),
                    metrics: Metrics.getSummary()
                };
            };

            // Ensure log export is available
            window.exportTwitchAdLogs = () => {
                const metricsSummary = Metrics.getSummary();
                const mergedLogs = Logger.getMergedTimeline();
                ReportGenerator.exportReport(metricsSummary, mergedLogs);
            };

            Logger.add('[CORE] Stream Healer ready', {
                config: {
                    detectionInterval: CONFIG.stall.DETECTION_INTERVAL_MS + 'ms',
                    stuckTrigger: CONFIG.stall.STUCK_COUNT_TRIGGER + ' checks',
                    healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
                }
            });
        }
    };
})();

CoreOrchestrator.init();



})();
