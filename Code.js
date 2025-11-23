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

// --- AdBlocker ---
/**
 * Handles the decision logic for detecting ads and triggers.
 * @responsibility
 * 1. Check URLs against ad patterns.
 * 2. Emit AD_DETECTED events.
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
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
        return isAd;
    };

    return {
        process
    };
})();

// --- Diagnostics ---
/**
 * Handles network traffic logging and diagnostics.
 * @responsibility
 * 1. Log network requests based on sampling/relevance.
 */
const Diagnostics = (() => {
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

    return {
        logNetworkRequest
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
            return {
                reason: 'Player stuck',
                details: { stuckCount: state.stuckCount, lastTime, currentTime }
            };
        }

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
        lastTotalFrames: 0
    };

    const reset = () => {
        state.lastDroppedFrames = 0;
        state.lastTotalFrames = 0;
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
            Logger.add('Frame drop detected', { newDropped, newTotal, recentDropRate: recentDropRate.toFixed(2) + '%' });

            if (newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD || (newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD && recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD)) {
                state.lastDroppedFrames = quality.droppedVideoFrames;
                state.lastTotalFrames = quality.totalVideoFrames;
                return {
                    reason: 'Severe frame drop',
                    details: { newDropped, newTotal, recentDropRate }
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
                state.lastSyncCheckTime = now;
                state.lastSyncVideoTime = video.currentTime;
                return {
                    reason: 'Persistent A/V sync issue',
                    details: { syncIssueCount: state.syncIssueCount, discrepancy }
                };
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

    const triggerRecovery = (reason, details) => {
        Logger.add(`HealthMonitor triggering recovery: ${reason}`, details);
        Metrics.increment('health_triggers');
        HealthMonitor.stop();
        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
    };

    const runMainChecks = () => {
        if (!videoRef || !document.body.contains(videoRef)) {
            HealthMonitor.stop();
            return;
        }

        // Check for stuck playback
        const stuckResult = StuckDetector.check(videoRef);
        if (stuckResult) {
            triggerRecovery(stuckResult.reason, stuckResult.details);
            return;
        }

        // Check for frame drops
        const frameDropResult = FrameDropDetector.check(videoRef);
        if (frameDropResult) {
            triggerRecovery(frameDropResult.reason, frameDropResult.details);
            return;
        }
    };

    const runSyncCheck = () => {
        if (!videoRef || !document.body.contains(videoRef)) {
            HealthMonitor.stop();
            return;
        }

        // Check A/V sync
        const syncResult = AVSyncDetector.check(videoRef);
        if (syncResult) {
            triggerRecovery(syncResult.reason, syncResult.details);
            return;
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
        },
        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            videoRef = null;
            StuckDetector.reset();
            FrameDropDetector.reset();
            AVSyncDetector.reset();
        },
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

// --- Play Retry Handler ---
/**
 * Handles video.play() with retry logic and exponential backoff.
 * @responsibility Ensure reliable playback resumption after recovery.
 */
const PlayRetryHandler = (() => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 300;

    return {
        retry: async (video, context = 'unknown') => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const playStartTime = performance.now();
                try {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} (${context})`, {
                        before: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime
                        },
                    });

                    await video.play();
                    await Fn.sleep(50);

                    if (!video.paused) {
                        Logger.add(`Play attempt ${attempt} SUCCESS`, {
                            context,
                            duration_ms: performance.now() - playStartTime
                        });
                        return true;
                    }

                    Logger.add(`Play attempt ${attempt} FAILED: video still paused`, {
                        context,
                        duration_ms: performance.now() - playStartTime
                    });
                } catch (error) {
                    Logger.add(`Play attempt ${attempt} threw error`, {
                        context,
                        error: error.message,
                        duration_ms: performance.now() - playStartTime
                    });

                    if (error.name === 'NotAllowedError') {
                        return false;
                    }
                }

                if (attempt < MAX_RETRIES) {
                    await Fn.sleep(BASE_DELAY_MS * attempt);
                }
            }

            Logger.add('All play attempts exhausted.', { context });
            return false;
        }
    };
})();

// --- Standard Recovery ---
/**
 * Simple seek-based recovery strategy.
 * @responsibility Seek to live edge without disrupting stream.
 */
const StandardRecovery = (() => {
    const SEEK_OFFSET_S = 0.5;

    return {
        execute: (video) => {
            Logger.add('Executing standard recovery: seeking');

            if (!video || !video.buffered || video.buffered.length === 0) {
                Logger.add('Standard recovery aborted: no buffer');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            video.currentTime = bufferEnd - SEEK_OFFSET_S;

            Logger.add('Standard recovery complete', {
                seekTo: video.currentTime,
                bufferEnd
            });
        }
    };
})();

// --- Aggressive Recovery ---
/**
 * Stream refresh recovery strategy via src clearing.
 * @responsibility Force stream refresh when stuck at buffer end.
 */
const AggressiveRecovery = (() => {
    const READY_CHECK_INTERVAL_MS = 100;

    return {
        execute: async (video) => {
            Metrics.increment('aggressive_recoveries');
            Logger.add('Executing aggressive recovery: forcing stream refresh');
            const recoveryStartTime = performance.now();

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            // Clear and reload stream
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

            // Wait for stream to be ready
            await new Promise(resolve => {
                const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / READY_CHECK_INTERVAL_MS;
                let checkCount = 0;
                const interval = setInterval(() => {
                    if (video.readyState >= 2) {
                        clearInterval(interval);
                        Logger.add('Stream reloaded.', {
                            duration_ms: performance.now() - recoveryStartTime
                        });
                        resolve();
                    } else if (++checkCount >= maxChecks) {
                        clearInterval(interval);
                        Logger.add('Stream reload timeout during aggressive recovery.');
                        resolve();
                    }
                }, READY_CHECK_INTERVAL_MS);
            });

            // Restore video state
            video.playbackRate = playbackRate;
            video.volume = volume;
            video.muted = muted;
        }
    };
})();

// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * @responsibility Implement strategy pattern for recovery selection.
 */
const RecoveryStrategy = (() => {
    return {
        select: (video) => {
            const analysis = BufferAnalyzer.analyze(video);

            Logger.add('Recovery strategy selection', {
                needsAggressive: analysis.needsAggressive,
                bufferHealth: analysis.bufferHealth,
                bufferSize: analysis.bufferSize
            });

            if (analysis.needsAggressive) {
                return AggressiveRecovery;
            }

            return StandardRecovery;
        }
    };
})();

// --- Resilience Orchestrator ---
/**
 * Orchestrates recovery execution.
 * @responsibility
 * 1. Guard against concurrent recovery attempts.
 * 2. Coordinate buffer analysis, strategy selection, and execution.
 * 3. Handle play retry after recovery.
 */
const ResilienceOrchestrator = (() => {
    let isFixing = false;

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

                // Check for fatal errors
                const { error } = video;
                if (error && error.code === CONFIG.codes.MEDIA_ERROR_SRC) {
                    Logger.add('Fatal error (code 4) - cannot recover, waiting for Twitch reload');
                    return;
                }

                // Check buffer and select strategy
                const analysis = BufferAnalyzer.analyze(video);
                if (analysis.bufferHealth === 'critical') {
                    Logger.add('Insufficient buffer for recovery, waiting');
                    return;
                }

                // Execute recovery strategy
                const strategy = RecoveryStrategy.select(video);
                await strategy.execute(video);

                // Resume playback if needed
                if (video.paused) {
                    await PlayRetryHandler.retry(video, 'post-recovery');
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
            } catch (e) {
                Logger.add('Resilience failed', { error: String(e) });
            } finally {
                isFixing = false;
                Logger.add('Resilience execution finished', {
                    total_duration_ms: performance.now() - startTime
                });
            }
        }
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

// --- Event Coordinator ---
/**
 * Sets up EventBus listeners and coordinates event responses.
 * @responsibility Wire up global event listeners for ACQUIRE and AD_DETECTED.
 */
const EventCoordinator = (() => {
    return {
        init: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, () => {
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    if (PlayerContext.get(container)) {
                        Logger.add('Event: ACQUIRE - Success');
                        HealthMonitor.start(container);
                    } else {
                        Logger.add('Event: ACQUIRE - Failed');
                    }
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
                Logger.add('Event: AD_DETECTED');
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    ResilienceOrchestrator.execute(container);
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

            // Wait for DOM if needed
            if (document.body) {
                DOMObserver.init();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    DOMObserver.init();
                }, { once: true });
            }
        }
    };
})();

CoreOrchestrator.init();

})();
