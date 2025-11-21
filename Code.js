// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       1.02
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
                HEALTH_CHECK_MS: 2000,
                LOG_THROTTLE: 5,
                LOG_EXPIRY_MIN: 5,
                REVERSION_DELAY_MS: 100,
                FORCE_PLAY_DEFER_MS: 1,
                REATTEMPT_DELAY_MS: 60 * 1000,
                PLAYBACK_TIMEOUT_MS: 2500,
            },
            network: {
                AD_PATTERNS: ['/ad/v1/', '/usher/v1/ad/', '/api/v5/ads/', 'pubads.g.doubleclick.net'],
                TRIGGER_PATTERNS: ['/ad_state/', 'vod_ad_manifest'],
            },
            mock: {
                M3U8: '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n',
                JSON: '{"data":[]}',
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
                timeout = setTimeout(() => func.apply(this, args), delay);
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
                const isM3U8 = url.includes('.m3u8');
                return {
                    body: isM3U8 ? CONFIG.mock.M3U8 : CONFIG.mock.JSON,
                    type: isM3U8 ? 'application/vnd.apple.mpegurl' : 'application/json'
                };
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
            (json) => json ? JSON.parse(json) : null,
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
            const process = (url) => {
                if (Logic.Network.isTrigger(url)) Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                return Logic.Network.isAd(url);
            };

            const hook = (target, handler) => new Proxy(target, { apply: handler });

            // XHR
            XMLHttpRequest.prototype.open = hook(XMLHttpRequest.prototype.open, (target, thisArg, args) => {
                const [method, url] = args;
                if (method === 'GET' && typeof url === 'string' && process(url)) {
                    // !CRITICAL: Mocking responses is essential.
                    // REASON: If we just block the request, the player will retry indefinitely or crash.
                    // We must return a valid (but empty) response to satisfy the player's state machine.
                    const { body } = Logic.Network.getMock(url);
                    thisArg.addEventListener('readystatechange', function inject() {
                        if (this.readyState === 2) {
                            Object.defineProperties(this, {
                                responseText: { value: body, writable: false },
                                response: { value: body, writable: false },
                                status: { value: 200, writable: false },
                                statusText: { value: 'OK', writable: false },
                            });
                            this.removeEventListener('readystatechange', inject);
                        }
                    });
                    return;
                }
                return Reflect.apply(target, thisArg, args);
            });

            // Fetch
            window.fetch = hook(window.fetch, (target, thisArg, args) => {
                const url = (typeof args[0] === 'string') ? args[0] : (args[0] instanceof Request ? args[0].url : '');
                if (url && process(url)) {
                    const { body, type } = Logic.Network.getMock(url);
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
                if (cachedContext) return cachedContext;
                if (!element) return null;
                for (const k in element) {
                    if (k.startsWith('__react') || k.startsWith('__vue') || k.startsWith('__next')) {
                        const ctx = searchRecursive(element[k]);
                        if (ctx) {
                            cachedContext = ctx;
                            return ctx;
                        }
                    }
                }
                return null;
            },
            reset: () => {
                cachedContext = null;
            }
        };
    })();

    // --- Health Monitor ---
    /**
     * Monitors video playback health to detect "stuck" states caused by ad injection.
     * @responsibility Detects when the player is technically "playing" but time is not advancing.
     */
    const HealthMonitor = (() => {
        let timer = null;
        let videoRef = null;
        let lastTime = 0;
        let stuckCount = 0;

        return {
            start: (container) => {
                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) return;

                if (videoRef !== video) {
                    HealthMonitor.stop();
                    videoRef = video;
                    lastTime = video.currentTime;
                    stuckCount = 0;
                }

                if (timer) return;

                timer = setInterval(() => {
                    if (!document.body.contains(videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }

                    // Check if video is stuck (time not advancing while not paused)
                    // !INVARIANT: A playing video MUST advance its currentTime.
                    if (!videoRef.paused && !videoRef.ended && videoRef.readyState < 4) {
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

                    // Trigger if stuck for ~4 seconds (2 checks * 2000ms)
                    if (stuckCount >= 2) {
                        HealthMonitor.stop();
                        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                    }
                }, CONFIG.timing.HEALTH_CHECK_MS);
            },

            stop: () => {
                if (timer) clearInterval(timer);
                timer = null;
                videoRef = null;
                stuckCount = 0;
            }
        };
    })();

    // --- Resilience ---
    /**
     * Executes the ad-blocking / recovery logic.
     * @responsibility
     * 1. Capture current player state.
     * 2. Force-reload the video source to skip the ad segment.
     * 3. Restore player state (time, volume, etc.).
     */
    const Resilience = {
        execute: async (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            // 1. Capture State
            const wasPaused = video.paused;
            const currentTime = video.currentTime;
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;

            // 2. Clear Source
            video.src = '';
            video.load();
            // !CRITICAL: Wait for cleanup.
            // REASON: Twitch's player needs time to unmount internal handlers.
            // < 50ms causes race conditions where the old stream isn't fully detached.
            await Fn.sleep(100);

            // 3. Restore Source with Cache Busting
            // @strategy Force the browser to treat this as a new stream by appending a timestamp.
            //           This bypasses internal player caches that might still hold the ad segment.
            const currentSrc = window.location.href;
            // Handle existing hash
            const [baseUrl, hash] = currentSrc.split('#');
            const separator = baseUrl.includes('?') ? '&' : '?';
            const newSrc = `${baseUrl}${separator}t=${Date.now()}${hash ? '#' + hash : ''}`;

            // Wait for canplay event before playing
            await new Promise((resolve) => {
                const handler = () => {
                    video.removeEventListener('canplay', handler);
                    resolve();
                };
                video.addEventListener('canplay', handler);

                // Set source after listener is attached
                video.src = newSrc;
                video.load();

                // Timeout fallback
                setTimeout(() => {
                    video.removeEventListener('canplay', handler);
                    resolve();
                }, CONFIG.timing.PLAYBACK_TIMEOUT_MS);
            });

            // 4. Restore State
            video.currentTime = currentTime;
            video.playbackRate = playbackRate;
            video.volume = volume;
            video.muted = muted;

            if (!wasPaused) {
                try {
                    await video.play();
                } catch (e) {
                    // Ignore play errors
                }
            }

            Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
        }
    };

    // --- Video Listener Manager ---
    /**
     * Manages event listeners on the video element to detect stream changes.
     * @responsibility Ensures we re-acquire the player context when the stream reloads (e.g., channel switch).
     */
    const VideoListenerManager = (() => {
        let activeElement = null;
        let activeHandler = null;

        return {
            attach: (container) => {
                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) return;

                if (activeElement === video) return;

                if (activeElement) {
                    activeElement.removeEventListener('loadstart', activeHandler);
                    activeElement = null;
                    activeHandler = null;
                }

                activeElement = video;
                activeHandler = () => Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
                activeElement.addEventListener('loadstart', activeHandler);
            },
            detach: () => {
                if (activeElement && activeHandler) {
                    activeElement.removeEventListener('loadstart', activeHandler);
                }
                activeElement = null;
                activeHandler = null;
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
            if (window.self !== window.top) return;

            const { lastAttempt, errorCount } = Store.get();
            const isThrottled = errorCount >= CONFIG.timing.LOG_THROTTLE && (Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS);

            if (isThrottled) {
                if (CONFIG.debug) console.warn('[MAD-3000] Core throttled.');
                return;
            }

            Network.init();
            Core.setupEvents();

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
                    if (ctx) HealthMonitor.start(Core.activeContainer);
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
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
            Core.activeContainer = container;

            Core.playerObserver = Adapters.DOM.observe(container, (mutations) => {
                let shouldReacquire = false;
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        const hasVideo = (nodes) => Array.from(nodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO));
                        if (hasVideo(m.addedNodes) || hasVideo(m.removedNodes)) shouldReacquire = true;
                    }
                    if (m.type === 'attributes' && m.attributeName === 'class') shouldReacquire = true;
                }
                if (shouldReacquire) Core.inject();
            }, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

            VideoListenerManager.attach(container);
            Core.inject();
        },

        handlePlayerUnmount: () => {
            if (!Core.activeContainer) return;
            if (CONFIG.debug) console.log('[MAD-3000] Player unmounted');

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