// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core) 2.00
// @version       2.00
// @description   🛡️ Stealth Reactor Core: Blocks Twitch ads with self-healing.
// @author        Senior Expert AI
// @match         *://*.twitch.tv/*
// @run-at        document-start
// @grant         none
// ==/UserScript==

(function () {
    'use strict';

/**
 * MEGA AD DODGER 3000 (Stealth Reactor Core)
 * A monolithic, self-contained userscript for Twitch ad blocking.
 * 
*/
/**
 * ARCHITECTURE MAP
 * 
 * [Core] -------------------------> [Network] (Intercepts XHR/Fetch)
 *   |                                 |
 *   +-> [PlayerContext]               +-> [Logic.Network] (Ad detection)
 *   |      |
 *   |      +-> [Logic.Player] (Signature scanning)
 *   |
 *   +-> [HealthMonitor] (Stuck detection)
 *   |
 *   +-> [Resilience] (Ad blocking execution)
 *          |
 *          +-> [VideoListenerManager] (Event cleanup)
 * 
 * EVENT BUS FLOW:
 * [Network] -> AD_DETECTED -> [Core] -> [Resilience]
 * [HealthMonitor] -> AD_DETECTED -> [Core] -> [Resilience]
 * [Core] -> ACQUIRE -> [PlayerContext] -> [HealthMonitor]
 */

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
        debug: true,
        selectors: {
            PLAYER: '.video-player',
            VIDEO: 'video',
        },
        timing: {
            RETRY_MS: 1000,
            INJECTION_MS: 50,
            HEALTH_CHECK_MS: 1000,
            LOG_THROTTLE: 5,
            LOG_EXPIRY_MIN: 5,
            REVERSION_DELAY_MS: 100,
            FORCE_PLAY_DEFER_MS: 1,
            REATTEMPT_DELAY_MS: 60 * 1000,
            PLAYBACK_TIMEOUT_MS: 2500,
            FRAME_DROP_SEVERE_THRESHOLD: 15,
            FRAME_DROP_MODERATE_THRESHOLD: 10,
            FRAME_DROP_RATE_THRESHOLD: 1.0,
            AV_SYNC_THRESHOLD_MS: 250,
            AV_SYNC_CHECK_INTERVAL_MS: 2000,
        },
        logging: {
            NETWORK_SAMPLE_RATE: 0.05,
            LOG_CSP_WARNINGS: true,
            LOG_NORMAL_NETWORK: false,
        },
        network: {
            AD_PATTERNS: ['/ad/v1/', '/usher/v1/ad/', '/api/v5/ads/', 'pubads.g.doubleclick.net', 'supervisor.ext-twitch.tv', '/3p/ads'],
            TRIGGER_PATTERNS: ['/ad_state/', 'vod_ad_manifest'],
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
            STANDARD_SEEK_BACK_S: 2,
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

// ============================================================================
// 4. LOGIC KERNELS
// ============================================================================
/**
 * Pure business logic for Network analysis and Player signature matching.
 * @namespace Logic
 */
const Logic = {
    Network: {
        isAd: (url) => CONFIG.regex.AD_BLOCK.test(url),
        isTrigger: (url) => CONFIG.regex.AD_TRIGGER.test(url),
        getMock: (url) => {
            if (url.includes('.m3u8')) {
                return { body: CONFIG.mock.M3U8, type: 'application/vnd.apple.mpegurl' };
            }
            if (url.includes('vast') || url.includes('xml')) {
                return { body: CONFIG.mock.VAST, type: 'application/xml' };
            }
            return { body: CONFIG.mock.JSON, type: 'application/json' };
        }
    },
    Player: {
        signatures: [
            { id: 'k0', check: (o, k) => o[k](true) == null }, // Toggle/Mute
            { id: 'k1', check: (o, k) => o[k]() == null },     // Pause
            { id: 'k2', check: (o, k) => o[k]() == null }      // Other
        ],
        validate: (obj, key, sig) => Fn.tryCatch(() => typeof obj[key] === 'function' && sig.check(obj, key), () => false)(),
    }
};

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

    return {
        increment,
        getSummary,
    };
})();

// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior,
 * log relevant data, and update metrics.
 * @responsibility Observes, interprets, and reacts to system-wide events and console output.
 */
const Instrumentation = (() => {
    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            Logger.add('Global Error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            });
            Metrics.increment('errors');
        });

        window.addEventListener('unhandledrejection', (event) => {
            Logger.add('Unhandled Rejection', {
                reason: event.reason ? event.reason.toString() : 'Unknown',
            });
            Metrics.increment('errors');
        });
    };

    const interceptConsoleError = () => {
        const originalError = console.error;
        const benignErrorSignatures = ['[GraphQL]', 'unauthenticated', 'PinnedChatSettings'];

        console.error = (...args) => {
            originalError.apply(console, args);
            try {
                const msg = args.map(String).join(' ');
                const isBenign = benignErrorSignatures.some(sig => msg.includes(sig));
                Logger.add('Console Error', { args: args.map(String), benign: isBenign });

                if (!isBenign) {
                    Metrics.increment('errors');
                    if (msg.includes('Error #4000') || msg.includes('MediaLoadInvalidURI')) {
                        Logger.add('Player crash detected, triggering recovery');
                        setTimeout(() => Adapters.EventBus.emit(CONFIG.events.AD_DETECTED), 300);
                    }
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    const interceptConsoleWarn = () => {
        const originalWarn = console.warn;
        const stallingDebounced = Fn.debounce(() => {
            Logger.add('Critical warning: Playhead stalling (debounced)');
            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
        }, 10000);

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                const msg = args.map(String).join(' ');
                if (msg.includes('Playhead stalling')) {
                    Logger.add('Playhead stalling warning detected (raw)');
                    stallingDebounced();
                } else if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                    Logger.add('CSP Warning', { args: args.map(String) });
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    return {
        init: () => {
            setupGlobalErrorHandlers();
            interceptConsoleError();
            interceptConsoleWarn();
        },
    };
})();

// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report
 * based on collected logs and metrics.
 * @responsibility Formats log and metric data into a report and handles file download.
 */
const ReportGenerator = (() => {
    const generateContent = (metricsSummary, logs) => {
        const header = `[METRICS]\nUptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s\nAds Detected: ${metricsSummary.ads_detected}\nAds Blocked: ${metricsSummary.ads_blocked}\nResilience Executions: ${metricsSummary.resilience_executions}\nAggressive Recoveries: ${metricsSummary.aggressive_recoveries}\nHealth Triggers: ${metricsSummary.health_triggers}\nErrors: ${metricsSummary.errors}\n\n[LOGS]\n`;
        const logContent = logs.map(l => `[${l.timestamp}] ${l.message}${l.detail ? ' | ' + JSON.stringify(l.detail) : ''}`).join('\n');
        return header + logContent;
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
            console.log("Generating and exporting report...");
            const content = generateContent(metricsSummary, logs);
            downloadFile(content);
        },
    };
})();

// --- Logger ---
/**
 * High-level logging and telemetry export.
 * @responsibility Collects logs and exports them as a file.
 */
const Logger = (() => {
    const logs = [];
    const MAX_LOGS = 5000;

    const add = (message, detail = null) => {
        if (logs.length >= MAX_LOGS) logs.shift();
        logs.push({
            timestamp: new Date().toISOString(),
            message,
            detail,
        });
    };

    return {
        add,
        init: () => {
            // Global error and console interception are now handled by the Instrumentation module.
            // This Logger.init is intentionally left empty.
        },
        export: () => {
            const metricsSummary = Metrics.getSummary();
            const rawLogs = logs; // Access the private logs array
            ReportGenerator.exportReport(metricsSummary, rawLogs);
        },
    };
})();

// Expose to global scope for user interaction
window.exportTwitchAdLogs = Logger.export;

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

// --- Network ---
/**
 * Intercepts XHR and Fetch requests to detect and block ads.
 * @responsibility
 * 1. Monitor network traffic for ad patterns.
 * 2. Mock responses for blocked ads to prevent player errors.
 * 3. Emit AD_DETECTED events.
 */
const Network = (() => {
    const process = (url, type) => {
        if (Logic.Network.isTrigger(url)) {
            Logger.add('Trigger pattern detected', { type, url });
            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
        }
        const isAd = Logic.Network.isAd(url);
        if (isAd) {
            Logger.add('Ad pattern detected', { type, url });
            Metrics.increment('ads_detected');
        }
        // Detailed logging is handled inside process to avoid duplication
        logNetworkRequest(url, type, isAd);
        return isAd;
    };

    const logNetworkRequest = (url, type, isAd) => {
        if (isAd) return;

        // --- START OF DIAGNOSTIC CHANGE ---
        // Temporarily increase logging to find new ad patterns.
        const isRelevant = url.includes('twitch') || url.includes('ttvnw') || url.includes('.m3u8');

        if (isRelevant && Math.random() < 0.25) { // Log 25% of relevant requests
            Logger.add('Network Request (DIAGNOSTIC)', { type, url });
        }
        // --- END OF DIAGNOSTIC CHANGE ---
    };

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

    const hookXHR = () => {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            if (method === 'GET' && typeof url === 'string' && process(url, 'XHR')) {
                this._isAdRequest = true;
            }
            originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            if (this._isAdRequest) {
                mockXhrResponse(this, this._responseURL);
                return;
            }
            originalSend.apply(this, arguments);
        };
    };

    const hookFetch = () => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
            const url = (typeof input === 'string') ? input : input.url;
            if (url && process(url, 'FETCH')) {
                const { body, type } = Logic.Network.getMock(url);
                Logger.add('Ad request blocked (FETCH)', { url });
                Metrics.increment('ads_blocked');
                return Promise.resolve(new Response(body, {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'Content-Type': type },
                }));
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

// --- Player Context ---
/**
 * React/Vue internal state scanner.
 * @responsibility Finds the internal React/Vue component instance associated with the DOM element.
 * @invariant This is a heuristic search; it may fail if Twitch changes their internal property names.
 * @volatile This module relies on obfuscated property names (k0, k1, k2). 
 *           If the script fails, CHECK THIS MODULE FIRST.
 */
const PlayerContext = (() => {
    let cachedContext = null;
    let keyMap = { k0: null, k1: null, k2: null };
    const contextHintKeywords = ['react', 'vue', 'next', 'props', 'fiber', 'internal'];

    const findKeysInObject = (obj) => {
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

    const searchRecursive = (obj, depth = 0, visited = new WeakSet()) => {
        if (depth > CONFIG.player.MAX_SEARCH_DEPTH || !obj || typeof obj !== 'object' || visited.has(obj)) {
            return null;
        }
        visited.add(obj);

        if (findKeysInObject(obj)) {
            return obj;
        }

        for (const key of Object.keys(obj)) {
            const found = searchRecursive(obj[key], depth + 1, visited);
            if (found) return found;
        }
        return null;
    };

    const validateCache = () => {
        if (!cachedContext) return false;
        const isValid = Object.keys(keyMap).every(
            (key) => keyMap[key] && typeof cachedContext[keyMap[key]] === 'function'
        );
        if (!isValid) {
            Logger.add('PlayerContext: ⚠️ CACHED CONTEXT INVALID', { keyMap });
            PlayerContext.reset();
            return false;
        }
        return true;
    };

    return {
        get: (element) => {
            if (validateCache()) {
                return cachedContext;
            }
            if (!element) return null;

            // Use Reflect.ownKeys to include Symbol properties, which React often uses.
            const keys = Reflect.ownKeys(element);

            for (const key of keys) {
                // Check if the property key contains any of our hints.
                const keyString = String(key).toLowerCase();
                if (contextHintKeywords.some(hint => keyString.includes(hint))) {
                    const potentialContext = element[key];
                    if (potentialContext && typeof potentialContext === 'object') {
                        const ctx = searchRecursive(potentialContext);
                        if (ctx) {
                            cachedContext = ctx;
                            Logger.add('PlayerContext: Fresh context found via keyword search', { key: String(key) });
                            return ctx;
                        }
                    }
                }
            }

            Logger.add('PlayerContext: Scan failed - no context found');
            return null;
        },
        reset: () => {
            cachedContext = null;
            keyMap = { k0: null, k1: null, k2: null };
        },
    };
})();

// --- Health Monitor ---
/**
 * Monitors video playback health to detect "stuck" states caused by ad injection.
 * @responsibility Detects when the player is technically "playing" but time is not advancing.
 * Also monitors audio/video synchronization issues.
 */
const HealthMonitor = (() => {
    let state = {};
    const timers = { main: null, sync: null };

    const resetState = (video = null) => {
        state = {
            videoRef: video,
            lastTime: video ? video.currentTime : 0,
            stuckCount: 0,
            lastDroppedFrames: 0,
            lastTotalFrames: 0,
            lastSyncCheckTime: 0,
            lastSyncVideoTime: video ? video.currentTime : 0,
            syncIssueCount: 0,
        };
    };

    const triggerRecovery = (reason, details) => {
        Logger.add(`HealthMonitor triggering recovery: ${reason}`, details);
        Metrics.increment('health_triggers');
        HealthMonitor.stop();
        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
    };

    const checkStuckState = () => {
        if (!state.videoRef) return;
        if (state.videoRef.paused || state.videoRef.ended) {
            if (CONFIG.debug && state.stuckCount > 0) {
                Logger.add('HealthMonitor[Debug]: Stuck count reset due to paused/ended state.');
            }
            state.stuckCount = 0;
            state.lastTime = state.videoRef.currentTime;
            return;
        }

        const currentTime = state.videoRef.currentTime;
        const lastTime = state.lastTime;
        const diff = Math.abs(currentTime - lastTime);

        if (CONFIG.debug) {
            Logger.add('HealthMonitor[Debug]: Stuck check', {
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
            triggerRecovery('Player stuck', { stuckCount: state.stuckCount, lastTime, currentTime });
        }
    };

    const checkDroppedFrames = () => {
        if (!state.videoRef || !state.videoRef.getVideoPlaybackQuality) return;

        const quality = state.videoRef.getVideoPlaybackQuality();
        const newDropped = quality.droppedVideoFrames - state.lastDroppedFrames;
        const newTotal = quality.totalVideoFrames - state.lastTotalFrames;

        if (CONFIG.debug) {
            Logger.add('HealthMonitor[Debug]: Frame check', {
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
            Logger.add('Frame drop detected', { newDropped, newTotal, recentDropRate: recentDropRate.toFixed(2) + '%' });

            if (newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD || (newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD && recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD)) {
                triggerRecovery('Severe frame drop', { newDropped, newTotal, recentDropRate });
            }
        }
        state.lastDroppedFrames = quality.droppedVideoFrames;
        state.lastTotalFrames = quality.totalVideoFrames;
    };

    const checkAVSync = () => {
        if (!state.videoRef) return;
        if (state.videoRef.paused || state.videoRef.ended || state.videoRef.readyState < 2) {
            if (state.syncIssueCount > 0) {
                Logger.add('A/V sync recovered', { previousIssues: state.syncIssueCount });
                state.syncIssueCount = 0;
            }
            return;
        }

        const now = Date.now();
        if (state.lastSyncCheckTime > 0) {
            const elapsedRealTime = (now - state.lastSyncCheckTime) / 1000;
            const expectedTimeAdvancement = elapsedRealTime * state.videoRef.playbackRate;
            const actualTimeAdvancement = state.videoRef.currentTime - state.lastSyncVideoTime;
            const discrepancy = Math.abs(expectedTimeAdvancement - actualTimeAdvancement);

            if (discrepancy > CONFIG.timing.AV_SYNC_THRESHOLD_MS / 1000 && expectedTimeAdvancement > 0.1) {
                state.syncIssueCount++;
                Logger.add('A/V sync issue detected', {
                    discrepancy: (discrepancy * 1000).toFixed(2) + 'ms',
                    count: state.syncIssueCount,
                });
            } else if (discrepancy < CONFIG.timing.AV_SYNC_THRESHOLD_MS / 2000) {
                if (state.syncIssueCount > 0) {
                    Logger.add('A/V sync recovered', { previousIssues: state.syncIssueCount });
                    state.syncIssueCount = 0;
                }
            }

            if (state.syncIssueCount >= 3) {
                triggerRecovery('Persistent A/V sync issue', { syncIssueCount: state.syncIssueCount, discrepancy });
                return;
            }
        }
        state.lastSyncCheckTime = now;
        state.lastSyncVideoTime = state.videoRef.currentTime;
    };

    return {
        start: (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            if (state.videoRef !== video) {
                HealthMonitor.stop();
                resetState(video);
            }

            if (!timers.main) {
                timers.main = setInterval(() => {
                    if (!state.videoRef || !document.body.contains(state.videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }
                    checkStuckState();
                    checkDroppedFrames();
                }, CONFIG.timing.HEALTH_CHECK_MS);
            }

            if (!timers.sync) {
                timers.sync = setInterval(() => {
                    if (!state.videoRef || !document.body.contains(state.videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }
                    checkAVSync();
                }, CONFIG.timing.AV_SYNC_CHECK_INTERVAL_MS);
            }
        },
        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            resetState();
        },
    };
})();

// --- Resilience ---
/**
 * Executes the ad-blocking / recovery logic.
 * @responsibility
 * 1. Capture current player state.
 * 2. Attempt to restore playback by seeking to the live edge or unpausing.
 * 3. When stuck at buffer end (currentTime ≈ bufferEnd), use aggressive recovery
 *    (video.src clearing) to force stream refresh and bypass blocked ad segments.
 * 4. Note: Aggressive recovery is only used when stuck at buffer end to avoid
 *    unnecessary WASM worker disruption.
 */
const Resilience = (() => {
    let isFixing = false;

    const playWithRetry = async (video, context = 'unknown') => {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const playStartTime = performance.now();
            try {
                Logger.add(`Play attempt ${attempt}/${maxRetries} (${context})`, {
                    before: { paused: video.paused, readyState: video.readyState, currentTime: video.currentTime },
                });
                await video.play();
                await Fn.sleep(50);
                if (!video.paused) {
                    Logger.add(`Play attempt ${attempt} SUCCESS`, { context, duration_ms: performance.now() - playStartTime });
                    return true;
                }
                Logger.add(`Play attempt ${attempt} FAILED: video still paused`, { context, duration_ms: performance.now() - playStartTime });
            } catch (error) {
                Logger.add(`Play attempt ${attempt} threw error`, { context, error: error.message, duration_ms: performance.now() - playStartTime });
                if (error.name === 'NotAllowedError') {
                    return false;
                }
            }
            if (attempt < maxRetries) {
                await Fn.sleep(300 * attempt);
            }
        }
        Logger.add('All play attempts exhausted.', { context });
        return false;
    };

    const aggressiveRecovery = async (video) => {
        Metrics.increment('aggressive_recoveries');
        Logger.add('Executing aggressive recovery: forcing stream refresh');
        const recoveryStartTime = performance.now();

        const playbackRate = video.playbackRate;
        const volume = video.volume;
        const muted = video.muted;
        const originalSrc = video.src;
        const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

        if (isBlobUrl) {
            Logger.add('Blob URL detected - performing unload/reload cycle.');
            video.src = '';
            video.load();
            await Fn.sleep(100);
            video.src = originalSrc;
            video.load();
        } else {
            video.src = '';
            video.load();
        }

        await new Promise(resolve => {
            const checkInterval = 100;
            const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / checkInterval;
            let checkCount = 0;
            const interval = setInterval(() => {
                if (video.readyState >= 2) {
                    clearInterval(interval);
                    Logger.add('Stream reloaded.', { duration_ms: performance.now() - recoveryStartTime });
                    resolve();
                } else if (++checkCount >= maxChecks) {
                    clearInterval(interval);
                    Logger.add('Stream reload timeout during aggressive recovery.');
                    resolve();
                }
            }, checkInterval);
        });

        video.playbackRate = playbackRate;
        video.volume = volume;
        video.muted = muted;
    };

    const standardRecovery = (video) => {
        Logger.add('Executing standard recovery: seeking');
        if (video.buffered.length > 0) {
            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            video.currentTime = bufferEnd - 0.5;
        }
    };

    return {
        execute: async (container) => {
            if (isFixing) {
                Logger.add('Resilience already in progress, skipping');
                return;
            }
            isFixing = true;
            const startTime = performance.now();

            try {
                Logger.add('Resilience execution started');
                Metrics.increment('resilience_executions');
                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) {
                    Logger.add('Resilience aborted: No video element found');
                    return;
                }

                const { currentTime, buffered, error } = video;
                if (error && error.code === CONFIG.codes.MEDIA_ERROR_SRC) {
                    Logger.add('Fatal error (code 4) - cannot recover, waiting for Twitch reload');
                    return;
                }

                let needsAggressive = false;
                if (buffered.length > 0) {
                    const bufferEnd = buffered.end(buffered.length - 1);
                    if (Math.abs(currentTime - bufferEnd) < 0.5) {
                        if ((bufferEnd - buffered.start(0)) < CONFIG.player.BUFFER_HEALTH_S) {
                            Logger.add('Insufficient buffer for recovery, waiting');
                            return;
                        }
                        needsAggressive = true;
                    }
                }

                if (needsAggressive) {
                    await aggressiveRecovery(video);
                } else {
                    standardRecovery(video);
                }

                if (video.paused) {
                    await playWithRetry(video, 'post-recovery');
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
            } catch (e) {
                Logger.add('Resilience failed', { error: String(e) });
            } finally {
                isFixing = false;
                Logger.add('Resilience execution finished', { total_duration_ms: performance.now() - startTime });
            }
        },
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

// ============================================================================
// 6. CORE ORCHESTRATOR
// ============================================================================
/**
 * Main entry point and event orchestrator.
 * @responsibility
 * 1. Initialize all modules.
 * 2. Observe DOM for player mounting/unmounting.
 * 3. Wire up EventBus listeners.
 */
const Core = {
    rootObserver: null,
    playerObserver: null,
    activeContainer: null,

    init: () => {
        Logger.add('Core initialized');
        if (window.self !== window.top) return;

        const { lastAttempt, errorCount } = Store.get();
        if (errorCount >= CONFIG.timing.LOG_THROTTLE && Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS) {
            if (CONFIG.debug) console.warn('[MAD-3000] Core throttled.');
            return;
        }

        Network.init();
        Instrumentation.init();
        Core.setupEvents();
        Core.setupScriptBlocker();

        if (document.body) {
            Core.startRootObservation();
        } else {
            document.addEventListener('DOMContentLoaded', () => Core.startRootObservation(), { once: true });
        }
    },

    setupScriptBlocker: () => {
        const scriptObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(n => {
                    if (n.tagName === 'SCRIPT' && n.src && (n.src.includes('supervisor.ext-twitch.tv') || n.src.includes('pubads.g.doubleclick.net'))) {
                        n.remove();
                        Logger.add('Blocked Script', { src: n.src });
                    }
                });
            }
        });
        scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
    },

    inject: () => {
        Store.update({ lastAttempt: Date.now() });
        Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
    },

    setupEvents: () => {
        Adapters.EventBus.on(CONFIG.events.ACQUIRE, () => {
            if (Core.activeContainer) {
                if (PlayerContext.get(Core.activeContainer)) {
                    Logger.add('Event: ACQUIRE - Success');
                    HealthMonitor.start(Core.activeContainer);
                } else {
                    Logger.add('Event: ACQUIRE - Failed');
                }
            }
        });

        Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
            Logger.add('Event: AD_DETECTED');
            if (Core.activeContainer) Resilience.execute(Core.activeContainer);
        });
    },

    findAndMountPlayer: (node) => {
        if (node.nodeType !== 1) return;
        const player = node.matches(CONFIG.selectors.PLAYER) ? node : node.querySelector(CONFIG.selectors.PLAYER);
        if (player) Core.handlePlayerMount(player);
    },

    findAndUnmountPlayer: (node) => {
        if (Core.activeContainer && (node === Core.activeContainer || (node.contains && node.contains(Core.activeContainer)))) {
            Core.handlePlayerUnmount();
        }
    },

    startRootObservation: () => {
        const existing = Adapters.DOM.find(CONFIG.selectors.PLAYER);
        if (existing) Core.handlePlayerMount(existing);

        Core.rootObserver = Adapters.DOM.observe(document.body, (mutations) => {
            for (const m of mutations) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(Core.findAndMountPlayer);
                    m.removedNodes.forEach(Core.findAndUnmountPlayer);
                }
            }
        }, { childList: true, subtree: true });
    },

    handlePlayerMount: (container) => {
        if (Core.activeContainer === container) return;
        if (Core.activeContainer) Core.handlePlayerUnmount();

        Logger.add('Player mounted');
        Core.activeContainer = container;

        const debouncedInject = Fn.debounce(() => Core.inject(), 100);
        Core.playerObserver = Adapters.DOM.observe(container, (mutations) => {
            const shouldReacquire = mutations.some(m => {
                if (m.type === 'attributes' && m.attributeName === 'class' && m.target === container) return true;
                if (m.type === 'childList') {
                    const hasVideo = (nodes) => Array.from(nodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO));
                    return hasVideo(m.addedNodes) || hasVideo(m.removedNodes);
                }
                return false;
            });
            if (shouldReacquire) debouncedInject();
        }, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        VideoListenerManager.attach(container);
        Core.inject();
    },

    handlePlayerUnmount: () => {
        if (!Core.activeContainer) return;
        Logger.add('Player unmounted');

        if (Core.playerObserver) {
            Core.playerObserver.disconnect();
            Core.playerObserver = null;
        }

        VideoListenerManager.detach();
        HealthMonitor.stop();
        PlayerContext.reset();
        Core.activeContainer = null;
    }
};

Core.init();

})();
