// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core) 1.20
// @version       1.20
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
            debug: false,
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
                FRAME_DROP_SEVERE_THRESHOLD: 15, // Frames dropped in one check period
                FRAME_DROP_MODERATE_THRESHOLD: 10, // Frames dropped for rate-based check
                FRAME_DROP_RATE_THRESHOLD: 1.0, // Percentage threshold for drop rate
                AV_SYNC_THRESHOLD_MS: 250, // Audio/video sync threshold in milliseconds
                AV_SYNC_CHECK_INTERVAL_MS: 2000, // Check A/V sync every 2 seconds
            },
            logging: {
                NETWORK_SAMPLE_RATE: 0.05, // 5% sample rate for normal network requests
                LOG_CSP_WARNINGS: true, // Log CSP warnings for evaluation
                LOG_NORMAL_NETWORK: false, // Only log normal network when debug=true
            },
            network: {
                AD_PATTERNS: ['/ad/v1/', '/usher/v1/ad/', '/api/v5/ads/', 'pubads.g.doubleclick.net', 'supervisor.ext-twitch.tv', 'vod-secure.twitch.tv', 'edge.ads.twitch.tv', '/3p/ads'],
                TRIGGER_PATTERNS: ['/ad_state/', 'vod_ad_manifest'],
            },
            mock: {
                M3U8: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n',
                JSON: '{"data":[]}',
                VAST: '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"><Ad><InLine><AdSystem>Twitch</AdSystem><AdTitle>Ad</AdTitle><Creatives></Creatives></InLine></Ad></VAST>'
            },
            player: {
                MAX_SEARCH_DEPTH: 15,
            }
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

    // ============================================================================
    // 5. MODULES
    // ============================================================================

    // --- Logger ---
    /**
     * High-level logging and telemetry export.
     * @responsibility Collects logs and exports them as a file.
     */
    const Logger = (() => {
        const logs = [];
        const MAX_LOGS = 5000;

        const metrics = {
            ads_detected: 0,
            ads_blocked: 0,
            resilience_executions: 0,
            aggressive_recoveries: 0,
            health_triggers: 0,
            errors: 0,
            session_start: Date.now()
        };

        return {
            add: (message, detail = null) => {
                if (logs.length >= MAX_LOGS) logs.shift();
                logs.push({
                    timestamp: new Date().toISOString(),
                    message,
                    detail
                });
            },
            addMetric: (category, increment = 1) => {
                if (metrics[category] !== undefined) {
                    metrics[category] += increment;
                }
            },
            getMetrics: () => ({
                ...metrics,
                uptime_ms: Date.now() - metrics.session_start,
                block_rate: metrics.ads_detected > 0
                    ? (metrics.ads_blocked / metrics.ads_detected * 100).toFixed(2) + '%'
                    : 'N/A'
            }),
            init: () => {
                // Capture global errors
                window.addEventListener('error', (event) => {
                    Logger.add('Global Error', {
                        message: event.message,
                        filename: event.filename,
                        lineno: event.lineno,
                        colno: event.colno
                    });
                    Logger.addMetric('errors');
                });

                // Capture unhandled promise rejections
                window.addEventListener('unhandledrejection', (event) => {
                    Logger.add('Unhandled Rejection', {
                        reason: event.reason ? event.reason.toString() : 'Unknown'
                    });
                    Logger.addMetric('errors');
                });

                // Intercept console.error to catch player errors
                const originalError = console.error;
                console.error = (...args) => {
                    try {
                        const msg = args.map(a => String(a)).join(' ');
                        const errorArgs = args.map(a => String(a));

                        // Filter benign errors that shouldn't count as critical errors
                        const isBenignError = msg.includes('[GraphQL]') &&
                            (msg.includes('unauthenticated') ||
                                msg.includes('PinnedChatSettings') ||
                                msg.includes('OneClickEligibility') ||
                                msg.includes('SubscriptionRewardPreviews') ||
                                msg.includes('ChannelGoalConnection'));

                        // Log all errors but only count critical ones
                        Logger.add('Console Error', {
                            args: errorArgs,
                            benign: isBenignError
                        });

                        if (!isBenignError) {
                            Logger.addMetric('errors');

                            // Detect player crash errors (critical errors only)
                            if (msg.includes('Error #4000') ||
                                msg.includes('unavailable or not supported') ||
                                msg.includes('MediaLoadInvalidURI') ||
                                msg.includes('NS_ERROR_DOM_INVALID_STATE_ERR')) {
                                Logger.add('Player crash detected in console - triggering recovery', { message: msg });
                                // Trigger recovery after a short delay
                                setTimeout(() => {
                                    Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                                }, 300);
                            }
                        }
                    } catch (e) { }
                    originalError.apply(console, args);
                };

                // Intercept console.warn (useful for player warnings)
                const originalWarn = console.warn;

                // Debounced handler for playhead stalling warnings
                // Prevents rapid-fire recovery triggers that exhaust buffer
                const playheadStallingDebounced = Fn.debounce(() => {
                    Logger.add('Critical warning detected: Playhead stalling (debounced - max 1 per 10s)');
                    Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                }, 10000); // 10-second debounce window

                console.warn = (...args) => {
                    try {
                        const msg = args.map(a => String(a)).join(' ');
                        const errorArgs = args.map(a => String(a));

                        // Detect CSP warnings (may be from Tampermonkey injection)
                        const isCSPWarning = msg.includes('Content-Security-Policy') ||
                            msg.includes('script-src-elem') ||
                            msg.includes('script-src') ||
                            (msg.includes('content.js') && msg.includes('blockiert'));

                        // Detect if it's related to userscript injection
                        const isTampermonkeyRelated = isCSPWarning && (
                            msg.includes('extension-files.twitch.tv') ||
                            msg.includes('ext-twitch.tv') ||
                            msg.includes('Tampermonkey') ||
                            msg.includes('userscript')
                        );

                        // Filter benign warnings that don't need logging
                        const isBenignWarning = msg.includes('React Router Future Flag Warning') ||
                            msg.includes('v7_startTransition') ||
                            msg.includes('v7_relativeSplatPath') ||
                            msg.includes('Moving to buffered region');

                        // Log CSP warnings if enabled (for evaluation even though we can't fix them)
                        if (CONFIG.logging.LOG_CSP_WARNINGS && isCSPWarning) {
                            Logger.add('CSP Warning (Tampermonkey/Extension Related)', {
                                args: errorArgs,
                                isTampermonkeyRelated,
                                note: isTampermonkeyRelated
                                    ? 'This warning is from Tampermonkey/extension script injection and cannot be fixed by the userscript'
                                    : 'CSP warning from page/extension - evaluate if it affects functionality'
                            });
                        }

                        // Only log non-benign, non-CSP warnings to reduce noise
                        if (!isBenignWarning && !isCSPWarning) {
                            Logger.add('Console Warn', { args: errorArgs });
                        }

                        // Critical warnings that trigger recovery
                        if (msg.includes('Playhead stalling')) {
                            Logger.add('Playhead stalling warning detected (raw)', {
                                message: msg,
                                timestamp: new Date().toISOString()
                            });
                            playheadStallingDebounced(); // Debounced - max 1 trigger per 10s
                        }
                    } catch (e) { }
                    originalWarn.apply(console, args);
                };
            },
            export: () => {
                console.log("logging is initiated");

                let content;
                if (logs.length === 0) {
                    content = "Logging is initiated. No logs recorded yet.";
                } else {
                    const m = Logger.getMetrics();
                    const header = `[METRICS]\nUptime: ${(m.uptime_ms / 1000).toFixed(1)}s\nAds Detected: ${m.ads_detected}\nAds Blocked: ${m.ads_blocked}\nResilience Executions: ${m.resilience_executions}\nAggressive Recoveries: ${m.aggressive_recoveries}\nHealth Triggers: ${m.health_triggers}\nErrors: ${m.errors}\n\n[LOGS]\n`;
                    content = header + logs.map(l => `[${l.timestamp}] ${l.message}${l.detail ? ' | ' + JSON.stringify(l.detail) : ''}`).join('\n');
                }

                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `twitch_ad_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
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
    const Network = {
        init: () => {
            const process = (url, type) => {
                if (Logic.Network.isTrigger(url)) {
                    Logger.add('Trigger pattern detected', { type, url });
                    Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                }
                const isAd = Logic.Network.isAd(url);
                if (isAd) {
                    Logger.add('Ad pattern detected', { type, url });
                    Logger.addMetric('ads_detected');
                }

                // Granular network logging: Keep important logs, reduce noise
                if (!isAd) {
                    // Always log potentially suspicious patterns (but throttled)
                    const isSuspiciousPattern = url.includes('/ad/') ||
                        url.includes('ads.') ||
                        url.includes('advertising') ||
                        (url.includes('usher') && url.includes('.m3u8'));

                    if (isSuspiciousPattern && Math.random() < CONFIG.logging.NETWORK_SAMPLE_RATE) {
                        Logger.add('Network Request (Suspicious Pattern - sample)', { type, url });
                    }

                    // Log normal requests only in debug mode (for troubleshooting)
                    if (CONFIG.logging.LOG_NORMAL_NETWORK && CONFIG.debug &&
                        Math.random() < CONFIG.logging.NETWORK_SAMPLE_RATE) {
                        if (url.includes('usher') || url.includes('.m3u8') || url.includes('twitch') || url.includes('ttvnw')) {
                            Logger.add('Network Request (Normal - debug sample)', { type, url });
                        }
                    }
                }

                return isAd;
            };

            const hook = (target, handler) => new Proxy(target, { apply: handler });

            // XHR
            XMLHttpRequest.prototype.open = hook(XMLHttpRequest.prototype.open, (target, thisArg, args) => {
                const [method, url] = args;
                if (method === 'GET' && typeof url === 'string' && process(url, 'XHR')) {
                    // !CRITICAL: Mocking responses is essential.
                    // REASON: If we just block the request, the player will retry indefinitely or crash.
                    // We must return a valid (but empty) response to satisfy the player's state machine.
                    const { body } = Logic.Network.getMock(url);
                    Logger.add('Ad request blocked (XHR)', { url });
                    Logger.addMetric('ads_blocked');

                    // Store the URL and mock body for later use
                    thisArg._blockedAd = { url, body };

                    // Intercept send to prevent actual network request and mock response immediately
                    const originalSend = thisArg.send;
                    thisArg.send = function (...sendArgs) {
                        if (this._blockedAd) {
                            // Mock the response immediately without sending network request
                            Object.defineProperties(this, {
                                readyState: { value: 4, writable: false, configurable: true },
                                responseText: { value: this._blockedAd.body, writable: false },
                                response: { value: this._blockedAd.body, writable: false },
                                status: { value: 200, writable: false },
                                statusText: { value: 'OK', writable: false },
                            });

                            // Trigger callbacks asynchronously to mimic real XHR behavior
                            queueMicrotask(() => {
                                // Create a proper ProgressEvent for readystatechange
                                if (this.onreadystatechange) {
                                    try {
                                        const readystatechangeEvent = new ProgressEvent('readystatechange', {
                                            bubbles: false,
                                            cancelable: false,
                                            lengthComputable: true,
                                            loaded: this.responseText ? this.responseText.length : 0,
                                            total: this.responseText ? this.responseText.length : 0
                                        });
                                        // Set target and currentTarget to the XHR object
                                        Object.defineProperty(readystatechangeEvent, 'target', { value: this, writable: false });
                                        Object.defineProperty(readystatechangeEvent, 'currentTarget', { value: this, writable: false });
                                        this.onreadystatechange.call(this, readystatechangeEvent);
                                    } catch (e) {
                                        Logger.add('XHR onreadystatechange error', { error: e.message });
                                    }
                                }
                                // Create a proper ProgressEvent for load
                                if (this.onload) {
                                    try {
                                        const loadEvent = new ProgressEvent('load', {
                                            bubbles: false,
                                            cancelable: false,
                                            lengthComputable: true,
                                            loaded: this.responseText ? this.responseText.length : 0,
                                            total: this.responseText ? this.responseText.length : 0
                                        });
                                        // Set target and currentTarget to the XHR object
                                        Object.defineProperty(loadEvent, 'target', { value: this, writable: false });
                                        Object.defineProperty(loadEvent, 'currentTarget', { value: this, writable: false });
                                        this.onload.call(this, loadEvent);
                                    } catch (e) {
                                        Logger.add('XHR onload error', { error: e.message });
                                    }
                                }
                            });

                            delete this._blockedAd;
                            return undefined;
                        }
                        return originalSend.apply(this, sendArgs);
                    };
                }
                return Reflect.apply(target, thisArg, args);
            });

            // Fetch
            window.fetch = hook(window.fetch, (target, thisArg, args) => {
                const url = (typeof args[0] === 'string') ? args[0] : (args[0] instanceof Request ? args[0].url : '');
                if (url && process(url, 'FETCH')) {
                    const { body, type } = Logic.Network.getMock(url);
                    Logger.add('Ad request blocked (FETCH)', { url });
                    Logger.addMetric('ads_blocked');
                    return Promise.resolve(new Response(body, { status: 200, statusText: 'OK', headers: { 'Content-Type': type } }));
                }
                return Reflect.apply(target, thisArg, args);
            });
        }
    };

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

        const findKeys = (obj) => {
            let foundCount = 0;
            for (const sig of Logic.Player.signatures) {
                if (keyMap[sig.id] && Logic.Player.validate(obj, keyMap[sig.id], sig)) {
                    foundCount++;
                    continue;
                }
                const foundKey = Object.keys(obj).find(k => Logic.Player.validate(obj, k, sig));
                if (foundKey) {
                    keyMap[sig.id] = foundKey;
                    Logger.add('Player signature found', { id: sig.id, key: foundKey });
                    foundCount++;
                }
            }
            return foundCount === Logic.Player.signatures.length;
        };

        const searchRecursive = (obj, depth = 0, visited = new WeakSet()) => {
            if (depth > CONFIG.player.MAX_SEARCH_DEPTH || !obj || typeof obj !== 'object') return null;
            if (visited.has(obj)) return null;
            visited.add(obj);

            if (findKeys(obj)) return obj;

            for (const k in obj) {
                if (obj[k] && typeof obj[k] === 'object') {
                    const found = searchRecursive(obj[k], depth + 1, visited);
                    if (found) return found;
                }
            }
            return null;
        };

        return {
            get: (element) => {
                if (cachedContext) {
                    // Validate cached context structure
                    const hasK0 = keyMap.k0 && typeof cachedContext[keyMap.k0] === 'function';
                    const hasK1 = keyMap.k1 && typeof cachedContext[keyMap.k1] === 'function';
                    const hasK2 = keyMap.k2 && typeof cachedContext[keyMap.k2] === 'function';
                    const isValid = hasK0 && hasK1 && hasK2;

                    // Get current video element for comparison
                    const currentVideo = element?.querySelector(CONFIG.selectors.VIDEO);

                    Logger.add('PlayerContext: Cache validation', {
                        isValid,
                        hasK0,
                        hasK1,
                        hasK2,
                        videoElementExists: !!currentVideo
                    });

                    if (!isValid) {
                        Logger.add('PlayerContext: ⚠️ CACHED CONTEXT INVALID - resetting cache and searching for fresh context');
                        // Reset invalid cache
                        cachedContext = null;
                        keyMap = { k0: null, k1: null, k2: null };
                        // Fall through to search for fresh context below
                    } else {
                        // Cache is valid, return it
                        return cachedContext;
                    }
                }
                if (!element) return null;
                for (const k in element) {
                    if (k.startsWith('__react') || k.startsWith('__vue') || k.startsWith('__next')) {
                        const ctx = searchRecursive(element[k]);
                        if (ctx) {
                            cachedContext = ctx;
                            Logger.add('PlayerContext: Fresh context found and cached');
                            return ctx;
                        }
                    }
                }
                Logger.add('PlayerContext: Scan failed - no context found');
                return null;
            },
            reset: () => {
                cachedContext = null;
                keyMap = { k0: null, k1: null, k2: null };
            }
        };
    })();

    // --- Health Monitor ---
    /**
     * Monitors video playback health to detect "stuck" states caused by ad injection.
     * @responsibility Detects when the player is technically "playing" but time is not advancing.
     * Also monitors audio/video synchronization issues.
     */
    const HealthMonitor = (() => {
        let timer = null;
        let syncTimer = null;
        let videoRef = null;
        let lastTime = 0;
        let stuckCount = 0;
        let lastDroppedFrames = 0;
        let lastTotalFrames = 0; // Track total frames for interval drop rate calculation
        let lastSyncCheckTime = 0; // Timestamp for sync check
        let lastSyncVideoTime = 0; // Video currentTime for sync check
        let syncIssueCount = 0;

        return {
            start: (container) => {
                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) return;

                if (videoRef !== video) {
                    HealthMonitor.stop();
                    videoRef = video;
                    lastTime = video.currentTime;
                    stuckCount = 0;
                    lastDroppedFrames = 0;
                    lastTotalFrames = 0;
                    lastSyncCheckTime = 0;
                    lastSyncVideoTime = video.currentTime;
                    syncIssueCount = 0;
                }

                if (timer) return;

                // Start A/V sync monitoring
                HealthMonitor.startSyncMonitoring();

                timer = setInterval(() => {
                    if (!document.body.contains(videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }

                    // 1. Check for Stuck State
                    // !INVARIANT: A playing video MUST advance its currentTime.
                    if (!videoRef.paused && !videoRef.ended) {
                        if (Math.abs(videoRef.currentTime - lastTime) < 0.1) {
                            stuckCount++;
                        } else {
                            stuckCount = 0;
                            lastTime = videoRef.currentTime;
                        }
                    } else {
                        stuckCount = 0;
                        lastTime = videoRef.currentTime;
                    }

                    // 2. Check for Dropped Frames (Rendering Performance)
                    if (videoRef.getVideoPlaybackQuality) {
                        const quality = videoRef.getVideoPlaybackQuality();
                        const dropped = quality.droppedVideoFrames;
                        const totalFrames = quality.totalVideoFrames;
                        const newDropped = dropped - lastDroppedFrames;

                        if (newDropped > 0 || totalFrames > lastTotalFrames) {
                            // Calculate recent drop rate (for current interval only)
                            // This avoids mixing cumulative stats with recent drop counts
                            const newTotalFrames = totalFrames - lastTotalFrames;
                            const recentDropRate = newTotalFrames > 0
                                ? (newDropped / newTotalFrames * 100)
                                : 0;

                            // Also log cumulative drop rate for context (but don't use for threshold)
                            const cumulativeDropRate = totalFrames > 0
                                ? (dropped / totalFrames * 100).toFixed(2)
                                : '0.00';

                            Logger.add('Frame Drop Detected', {
                                newDropped: newDropped,
                                newTotalFrames: newTotalFrames,
                                recentDropRate: recentDropRate.toFixed(2) + '%',
                                totalDropped: dropped,
                                totalFrames: totalFrames,
                                cumulativeDropRate: cumulativeDropRate + '%'
                            });

                            // Fixed threshold logic: Use recent drop rate, not cumulative
                            // Trigger recovery if:
                            // - More than 15 frames dropped in one check (severe freeze)
                            // - OR recent drop rate exceeds threshold AND more than 10 frames dropped (consistent degradation in current interval)
                            const recentDropRateThreshold = recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD;
                            const severeDrop = newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD;
                            const moderateDropWithHighRate = newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD && recentDropRateThreshold;

                            if (severeDrop || moderateDropWithHighRate) {
                                Logger.add('Severe frame drop detected, triggering recovery', {
                                    reason: severeDrop ? 'absolute_threshold' : 'recent_rate_threshold',
                                    newDropped,
                                    newTotalFrames,
                                    recentDropRate: recentDropRate.toFixed(2) + '%',
                                    cumulativeDropRate: cumulativeDropRate + '%'
                                });
                                Logger.addMetric('health_triggers');
                                HealthMonitor.stop();
                                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                                return;
                            }

                            lastDroppedFrames = dropped;
                            lastTotalFrames = totalFrames;
                        } else if (totalFrames !== lastTotalFrames) {
                            // Update tracking even if no drops (in case frames advanced)
                            lastTotalFrames = totalFrames;
                        }
                    }

                    // Trigger if stuck for ~2 seconds (2 checks * 1000ms)
                    if (stuckCount >= 2) {
                        Logger.add('Player stuck detected', { stuckCount, currentTime: videoRef.currentTime });
                        Logger.addMetric('health_triggers');
                        HealthMonitor.stop();
                        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                    }
                }, CONFIG.timing.HEALTH_CHECK_MS);
            },

            startSyncMonitoring: () => {
                if (syncTimer) return;

                syncTimer = setInterval(() => {
                    if (!videoRef || !document.body.contains(videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }

                    // A/V Sync Detection
                    // Check for audio/video synchronization issues by monitoring timing discrepancies
                    if (!videoRef.paused && !videoRef.ended && videoRef.readyState >= 2) {
                        const currentTime = videoRef.currentTime;
                        const now = Date.now();

                        // Check if we have audio tracks (for context, not always available)
                        const audioTracks = videoRef.audioTracks;
                        const videoTracks = videoRef.videoTracks;

                        // Monitor playback timing discrepancies to detect A/V sync issues
                        if (lastSyncCheckTime > 0) {
                            const elapsedRealTime = (now - lastSyncCheckTime) / 1000; // Real elapsed time in seconds
                            const expectedTimeAdvancement = elapsedRealTime * videoRef.playbackRate;
                            const actualTimeAdvancement = currentTime - lastSyncVideoTime;
                            const timeDiscrepancy = Math.abs(expectedTimeAdvancement - actualTimeAdvancement);

                            // Check for significant timing discrepancies that indicate sync/stutter issues
                            // This detects when video time doesn't advance as expected, which can indicate:
                            // - Audio/video desynchronization
                            // - Playback stuttering
                            // - Buffer underruns affecting sync
                            if (timeDiscrepancy > CONFIG.timing.AV_SYNC_THRESHOLD_MS / 1000 &&
                                expectedTimeAdvancement > 0.1 &&
                                actualTimeAdvancement >= 0) { // Ignore backward seeks during check
                                syncIssueCount++;

                                Logger.add('A/V Sync Issue Detected', {
                                    timeDiscrepancy: (timeDiscrepancy * 1000).toFixed(2) + 'ms',
                                    expected: expectedTimeAdvancement.toFixed(3) + 's',
                                    actual: actualTimeAdvancement.toFixed(3) + 's',
                                    elapsedRealTime: elapsedRealTime.toFixed(3) + 's',
                                    currentTime: currentTime.toFixed(2),
                                    playbackRate: videoRef.playbackRate,
                                    syncIssueCount,
                                    hasAudioTracks: audioTracks && audioTracks.length > 0,
                                    hasVideoTracks: videoTracks && videoTracks.length > 0
                                });

                                // If sync issues persist (3 checks = ~6 seconds), trigger recovery
                                if (syncIssueCount >= 3) {
                                    Logger.add('Persistent A/V sync issues detected, triggering recovery', {
                                        syncIssueCount,
                                        timeDiscrepancy: (timeDiscrepancy * 1000).toFixed(2) + 'ms',
                                        note: 'A/V sync issues may be caused by ad segments or playback corruption'
                                    });
                                    Logger.addMetric('health_triggers');
                                    HealthMonitor.stop();
                                    Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                                    return;
                                }
                            } else if (timeDiscrepancy <= CONFIG.timing.AV_SYNC_THRESHOLD_MS / 1000 / 2) {
                                // Reset counter if sync is good (half threshold for recovery)
                                if (syncIssueCount > 0) {
                                    Logger.add('A/V sync recovered', {
                                        previousIssues: syncIssueCount,
                                        timeDiscrepancy: (timeDiscrepancy * 1000).toFixed(2) + 'ms'
                                    });
                                    syncIssueCount = 0;
                                }
                            }
                        }

                        // Update sync tracking
                        lastSyncCheckTime = now;
                        lastSyncVideoTime = currentTime;
                    } else {
                        // Reset tracking when paused/ended
                        lastSyncCheckTime = 0;
                        syncIssueCount = 0;
                    }
                }, CONFIG.timing.AV_SYNC_CHECK_INTERVAL_MS);
            },

            stop: () => {
                if (timer) clearInterval(timer);
                if (syncTimer) clearInterval(syncTimer);
                timer = null;
                syncTimer = null;
                videoRef = null;
                stuckCount = 0;
                lastDroppedFrames = 0;
                lastTotalFrames = 0;
                lastSyncCheckTime = 0;
                lastSyncVideoTime = 0;
                syncIssueCount = 0;
            }
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

        return {
            execute: async (container) => {
                if (isFixing) {
                    Logger.add('Resilience already in progress, skipping');
                    return;
                }
                isFixing = true;

                try {
                    Logger.add('Resilience execution started');
                    Logger.addMetric('resilience_executions');
                    const video = container.querySelector(CONFIG.selectors.VIDEO);
                    if (!video) {
                        Logger.add('Resilience aborted: No video element found');
                        return;
                    }

                    // 1. Capture State
                    const wasPaused = video.paused;
                    const currentTime = video.currentTime;
                    const buffered = video.buffered;
                    const hasError = video.error !== null;
                    const errorCode = video.error ? video.error.code : null;

                    Logger.add('Captured player state', {
                        currentTime,
                        wasPaused,
                        bufferedLength: buffered.length,
                        hasError,
                        errorCode,
                        readyState: video.readyState,
                        networkState: video.networkState
                    });

                    // If player has a fatal error (code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED), 
                    // we need to wait for Twitch to recreate the player rather than trying to fix it
                    if (hasError && errorCode === 4) {
                        Logger.add('Player has fatal error (code 4) - cannot recover, waiting for Twitch to recreate player', {
                            errorMessage: video.error.message
                        });
                        // Reset the fixing flag so we can try again when player is recreated
                        isFixing = false;
                        return;
                    }

                    // 2. Recovery Strategy: Seek to Live / Buffer End
                    let needsAggressiveRecovery = false;
                    if (buffered.length > 0) {
                        const bufferEnd = buffered.end(buffered.length - 1);
                        const seekTarget = bufferEnd - 0.5;
                        const timeDiff = Math.abs(currentTime - seekTarget);
                        const isStuckAtBufferEnd = Math.abs(currentTime - bufferEnd) < 0.5;

                        // CRITICAL: If stuck at buffer end, player can't advance because next segment is blocked
                        // This requires aggressive recovery to force stream refresh
                        if (isStuckAtBufferEnd) {
                            Logger.add('Stuck at buffer end detected - requires aggressive recovery', {
                                currentTime,
                                bufferEnd,
                                diff: Math.abs(currentTime - bufferEnd)
                            });
                            needsAggressiveRecovery = true;
                        } else if (timeDiff > 1) {
                            Logger.add('Seeking to buffer end', { from: currentTime, to: seekTarget });
                            video.currentTime = seekTarget;
                        } else {
                            // Close to buffer end but not stuck - try small backward seek to force refresh
                            Logger.add('Close to buffer end, attempting small backward seek', {
                                currentTime,
                                bufferEnd,
                                diff: timeDiff
                            });
                            video.currentTime = Math.max(0, currentTime - 2);
                        }
                    } else {
                        Logger.add('No buffer detected, attempting play');
                    }

                    // 3. Aggressive Recovery (only when stuck at buffer end)
                    if (needsAggressiveRecovery) {
                        Logger.addMetric('aggressive_recoveries');
                        Logger.add('Executing aggressive recovery: forcing stream refresh', {
                            beforeState: {
                                readyState: video.readyState,
                                paused: video.paused,
                                currentTime: video.currentTime,
                                bufferedLength: video.buffered.length,
                                bufferEnd: buffered.length > 0 ? buffered.end(buffered.length - 1) : null
                            }
                        });
                        const playbackRate = video.playbackRate;
                        const volume = video.volume;
                        const muted = video.muted;

                        // CRITICAL: Capture original source before clearing (for fallback restoration)
                        const originalSrc = video.src;
                        const originalSrcObject = video.srcObject;
                        const originalCurrentSrc = video.currentSrc;
                        const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');
                        Logger.add('Captured original video source', {
                            src: originalSrc || '(empty)',
                            hasSrcObject: !!originalSrcObject,
                            currentSrc: originalCurrentSrc || '(empty)',
                            isBlobUrl: isBlobUrl
                        });

                        // CRITICAL: Don't clear blob URLs - they're managed by Twitch and can't be restored
                        // Instead, try a less aggressive approach: seek backward to force buffer refresh
                        if (isBlobUrl) {
                            Logger.add('Blob URL detected - using less aggressive recovery (seek backward instead of clearing source)');
                            try {
                                // Seek backward to force buffer refresh without breaking the blob URL
                                const seekBack = Math.max(0, currentTime - 3);
                                video.currentTime = seekBack;
                                Logger.add('Seeked backward to force buffer refresh', { from: currentTime, to: seekBack });
                                await Fn.sleep(500);

                                // Try to play if paused
                                if (video.paused) {
                                    await video.play();
                                }

                                // Check if recovery was successful
                                await Fn.sleep(1000);
                                if (video.readyState >= 2 && !video.paused && video.currentTime - seekBack > 0.5) {
                                    Logger.add('Less aggressive recovery successful - playback resumed');
                                } else {
                                    Logger.add('Less aggressive recovery failed - player may need page refresh', {
                                        readyState: video.readyState,
                                        paused: video.paused,
                                        currentTime: video.currentTime
                                    });
                                    // If less aggressive recovery fails, we can't safely clear blob URLs
                                    // The player will need to be recreated by Twitch or page refreshed
                                }
                            } catch (e) {
                                Logger.add('Less aggressive recovery error', { error: e.message });
                            }
                        } else {
                            // Non-blob URL: proceed with original aggressive recovery
                            Logger.add('Clearing video source and loading');
                            video.src = '';
                            video.load();
                            await Fn.sleep(100);
                            Logger.add('Source cleared, waiting for stream reload');

                            // Wait for stream to reload (with timeout)
                            let reloadSuccess = false;
                            await new Promise((resolve) => {
                                let checkCount = 0;
                                const maxChecks = 25; // 2.5 seconds max
                                const initialReadyState = video.readyState;

                                const checkReady = setInterval(() => {
                                    checkCount++;
                                    if (video.readyState >= 2) {
                                        clearInterval(checkReady);
                                        reloadSuccess = true;
                                        Logger.add('Stream reloaded successfully', {
                                            readyState: video.readyState,
                                            checks: checkCount,
                                            initialReadyState
                                        });
                                        resolve();
                                    } else if (checkCount >= maxChecks) {
                                        clearInterval(checkReady);
                                        Logger.add('Stream reload timeout', {
                                            readyState: video.readyState,
                                            checks: checkCount,
                                            initialReadyState
                                        });
                                        resolve(); // Don't block forever
                                    }
                                }, 100);
                            });

                            // Fallback: If Twitch didn't reload automatically, restore original source
                            if (!reloadSuccess && video.readyState < 2) {
                                Logger.add('Twitch did not reload automatically - restoring original source as fallback', {
                                    readyState: video.readyState,
                                    willRestoreSrc: !!originalSrc,
                                    willRestoreSrcObject: !!originalSrcObject
                                });
                                try {
                                    if (originalSrcObject) {
                                        video.srcObject = originalSrcObject;
                                        Logger.add('Restored original srcObject');
                                    } else if (originalSrc && !originalSrc.startsWith('blob:')) {
                                        // Only restore non-blob URLs
                                        video.src = originalSrc;
                                        video.load();
                                        Logger.add('Restored original src and called load()');
                                    } else if (originalCurrentSrc && !originalCurrentSrc.startsWith('blob:')) {
                                        video.src = originalCurrentSrc;
                                        video.load();
                                        Logger.add('Restored original currentSrc and called load()');
                                    } else {
                                        Logger.add('No valid source available to restore - Twitch must handle reload');
                                    }
                                } catch (e) {
                                    Logger.add('Error restoring original source', { error: e.message });
                                }
                            }
                        }

                        // Restore state
                        try {
                            video.playbackRate = playbackRate;
                            video.volume = volume;
                            video.muted = muted;
                            Logger.add('Player state restored after aggressive recovery', {
                                playbackRate,
                                volume,
                                muted
                            });
                        } catch (e) {
                            Logger.add('State restoration error after aggressive recovery', { error: e.message });
                        }

                        // Log final state after aggressive recovery
                        const newBuffered = video.buffered;
                        Logger.add('Aggressive recovery completed', {
                            afterState: {
                                readyState: video.readyState,
                                paused: video.paused,
                                currentTime: video.currentTime,
                                bufferedLength: newBuffered.length,
                                bufferEnd: newBuffered.length > 0 ? newBuffered.end(newBuffered.length - 1) : null,
                                duration: video.duration
                            }
                        });
                    }

                    // 4. Force Play
                    if (video.paused) {
                        try {
                            await video.play();
                            Logger.add('Forced play command sent', {
                                wasPaused: wasPaused,
                                afterPlayPaused: video.paused
                            });
                        } catch (e) {
                            Logger.add('Play command failed', { error: String(e) });
                        }
                    } else if (needsAggressiveRecovery) {
                        // If aggressive recovery was used and video wasn't paused, verify it's still playing
                        Logger.add('Video was already playing, verifying playback after aggressive recovery', {
                            paused: video.paused,
                            currentTime: video.currentTime
                        });
                    }

                    Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
                } catch (e) {
                    Logger.add('Resilience failed', { error: String(e) });
                } finally {
                    isFixing = false;
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
                Logger.addMetric('errors');

                // Error code 4 = MEDIA_ELEMENT_ERROR: Format error / Not supported
                // This often indicates the player is in an unrecoverable state
                if (error && (error.code === 4 || error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)) {
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
            const isThrottled = errorCount >= CONFIG.timing.LOG_THROTTLE && (Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS);

            if (isThrottled) {
                if (CONFIG.debug) console.warn('[MAD-3000] Core throttled.');
                return;
            }

            Network.init();
            Logger.init();
            Core.setupEvents();

            // Script Blocker for Supervisor and other unwanted scripts
            const scriptObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(n => {
                            if (n.tagName === 'SCRIPT' && n.src) {
                                if (n.src.includes('supervisor.ext-twitch.tv') || n.src.includes('pubads.g.doubleclick.net')) {
                                    n.remove();
                                    Logger.add('Blocked Script', { src: n.src });
                                }
                            }
                        });
                    }
                }
            });
            scriptObserver.observe(document.documentElement, { childList: true, subtree: true });

            const start = () => {
                if (document.body) {
                    Core.startRootObservation();
                } else {
                    setTimeout(start, 50);
                }
            };
            start();
        },

        inject: () => {
            Store.update({ lastAttempt: Date.now() });
            Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
        },

        setupEvents: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, () => {
                if (Core.activeContainer) {
                    const ctx = PlayerContext.get(Core.activeContainer);
                    if (ctx) {
                        Logger.add('Event: ACQUIRE - Success (Player Context Found)');
                        HealthMonitor.start(Core.activeContainer);
                    } else {
                        Logger.add('Event: ACQUIRE - Failed (Player Context Not Found)');
                    }
                } else {
                    Logger.add('Event: ACQUIRE - No Active Container');
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
                Logger.add('Event: AD_DETECTED');
                if (Core.activeContainer) Resilience.execute(Core.activeContainer);
            });

            Adapters.EventBus.on(CONFIG.events.LOG, ({ status, detail }) => {
                const current = Store.get();
                const count = current.errorCount + 1;
                const updates = { errorCount: count, lastError: `${status}: ${detail}` };
                if (count < CONFIG.timing.LOG_THROTTLE) updates.lastAttempt = Date.now();
                Store.update(updates);
            });

            Adapters.EventBus.on(CONFIG.events.REPORT, ({ status }) => {
                Logger.add('Event: REPORT', { status });
                if (status === 'SUCCESS') {
                    Store.update({ errorCount: 0, lastError: null });
                }
            });
        },

        startRootObservation: () => {
            const existing = Adapters.DOM.find(CONFIG.selectors.PLAYER);
            if (existing) Core.handlePlayerMount(existing);

            Core.rootObserver = Adapters.DOM.observe(document.body, (mutations) => {
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(n => {
                            if (n.nodeType === 1) {
                                if (n.matches(CONFIG.selectors.PLAYER)) Core.handlePlayerMount(n);
                                else if (n.querySelector) {
                                    const p = n.querySelector(CONFIG.selectors.PLAYER);
                                    if (p) Core.handlePlayerMount(p);
                                }
                            }
                        });
                        m.removedNodes.forEach(n => {
                            if (n === Core.activeContainer) Core.handlePlayerUnmount();
                            else if (n.contains && Core.activeContainer && n.contains(Core.activeContainer)) Core.handlePlayerUnmount();
                        });
                    }
                }
            }, { childList: true, subtree: true });
        },

        handlePlayerMount: (container) => {
            if (Core.activeContainer === container) return;
            if (Core.activeContainer) Core.handlePlayerUnmount();

            if (CONFIG.debug) console.log('[MAD-3000] Player mounted');
            Logger.add('Player mounted');
            Core.activeContainer = container;

            const debouncedInject = Fn.debounce(() => Core.inject(), 100);

            Core.playerObserver = Adapters.DOM.observe(container, (mutations) => {
                let shouldReacquire = false;
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        const hasVideo = (nodes) => Array.from(nodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO));
                        if (hasVideo(m.addedNodes) || hasVideo(m.removedNodes)) shouldReacquire = true;
                    }
                    // Only react to class changes on the main container, not every child element
                    if (m.type === 'attributes' && m.attributeName === 'class' && m.target === container) {
                        shouldReacquire = true;
                    }
                }
                if (shouldReacquire) debouncedInject();
            }, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

            VideoListenerManager.attach(container);
            Core.inject();
        },

        handlePlayerUnmount: () => {
            if (!Core.activeContainer) return;
            if (CONFIG.debug) console.log('[MAD-3000] Player unmounted');
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