// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core) - V3.66 COMPOSABLE PIPELINES
// @version       3.67
// @description   🛡️ Stealth Reactor Core: Blocks Twitch ads with self-healing and remote configuration.
// @author        Senior Expert AI (Refactored)
// @match         *://*.twitch.tv/*
// @run-at        document-start
// @grant         none
// ==/UserScript==

(function () {
    'use strict';

    /**
     * MEGA AD DODGER 3000 (Refactored v3.67)
     * A monolithic, self-contained userscript for Twitch ad blocking.
     * 
     * CHANGES v3.67:
     * - Reinstated Video Listener Cleanup to prevent memory leaks.
     * - Added Initial Acquisition Flag for faster first-load blocking.
     * - Enhanced Player Element Removal Detection for edge cases.
     */

    // ============================================================================
    // 1. CONFIGURATION & CONSTANTS
    // ============================================================================
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
                REVERSION_DELAY_MS: 2,
                FORCE_PLAY_DEFER_MS: 1,
                REATTEMPT_DELAY_MS: 15 * 60 * 1000,
            },
            network: {
                AD_PATTERNS: ['video-weaver.syd03.hls.ttvnw.net/ad/v1/', '/usher/v1/ad/', '/api/v5/ads/', 'pubads.g.doubleclick.net'],
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
                AD_BLOCK: new RegExp(raw.network.AD_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
                AD_TRIGGER: new RegExp(raw.network.AD_PATTERNS.concat(raw.network.TRIGGER_PATTERNS).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
            }
        });
    })();

    // ============================================================================
    // 2. FUNCTIONAL UTILITIES
    // ============================================================================
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
            getKeys: () => keyMap,
            reset: () => { cachedContext = null; keyMap = { k0: null, k1: null, k2: null }; }
        };
    })();

    // --- Resilience ---
    const Resilience = {
        execute: async (container) => {
            const ctx = PlayerContext.get(container);
            if (!ctx) {
                Adapters.EventBus.emit(CONFIG.events.LOG, { status: 'REVERT_FAIL', detail: 'No player context' });
                return;
            }

            const keys = PlayerContext.getKeys();
            const video = container.querySelector(CONFIG.selectors.VIDEO);

            try {
                if (video) { video.src = ''; video.load(); }

                await Fn.sleep(CONFIG.timing.REVERSION_DELAY_MS);
                ctx[keys.k1]();      // Pause
                ctx[keys.k0](true);  // Mute/Toggle

                if (video) {
                    const src = video.src;
                    const bust = '?t=' + Math.random().toString(36).substring(2);
                    video.src = '';
                    video.load();

                    await Fn.sleep(CONFIG.timing.FORCE_PLAY_DEFER_MS);
                    video.src = src.split('?')[0] + bust;
                    video.load();
                    video.play();
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
            } catch (e) {
                Resilience.fallback(container);
            }
        },

        fallback: (container) => {
            if (CONFIG.debug) console.warn('[MAD-3000] Reversion failed, attempting DOM replacement.');
            const clone = Adapters.DOM.clone(container);
            Adapters.DOM.replace(container, clone);
            PlayerContext.reset();

            setTimeout(() => {
                const v = clone.querySelector(CONFIG.selectors.VIDEO);
                if (v) v.play();
            }, CONFIG.timing.REVERSION_DELAY_MS);
        }
    };

    // --- Health Monitor ---
    const HealthMonitor = {
        timer: null,
        videoRef: null,

        start: (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            if (HealthMonitor.videoRef !== video) {
                HealthMonitor.stop();
                HealthMonitor.videoRef = video;
            }

            if (HealthMonitor.timer) return;

            HealthMonitor.timer = setInterval(() => {
                if (!document.body.contains(HealthMonitor.videoRef)) {
                    HealthMonitor.stop();
                    return;
                }
                if (HealthMonitor.videoRef.readyState < 4 && !HealthMonitor.videoRef.paused && !HealthMonitor.videoRef.ended) {
                    HealthMonitor.stop();
                    Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
                }
            }, CONFIG.timing.HEALTH_CHECK_MS);
        },

        stop: () => {
            if (HealthMonitor.timer) clearInterval(HealthMonitor.timer);
            HealthMonitor.timer = null;
            HealthMonitor.videoRef = null;
        }
    };

    // --- Video Listener Manager ---
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
            }
        };
    })();

    // ============================================================================
    // 6. CORE ORCHESTRATOR
    // ============================================================================
    const Core = {
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

            setTimeout(() => {
                Core.inject();
                Core.observeLifecycle();
            }, CONFIG.timing.INJECTION_MS);
        },

        inject: () => {
            Store.update({ lastAttempt: Date.now() });
            Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
        },

        setupEvents: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, () => {
                const container = Adapters.DOM.find(CONFIG.selectors.PLAYER);
                if (container) {
                    const ctx = PlayerContext.get(container);
                    if (ctx) HealthMonitor.start(container);
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
                const c = Adapters.DOM.find(CONFIG.selectors.PLAYER);
                if (c) Resilience.execute(c);
            });

            Adapters.EventBus.on(CONFIG.events.LOG, ({ status, detail }) => {
                const current = Store.get();
                const count = current.errorCount + 1;
                const updates = { errorCount: count, lastError: `${status}: ${detail}` };
                if (count < CONFIG.timing.LOG_THROTTLE) updates.lastAttempt = Date.now();
                Store.update(updates);
            });
        },

        observeLifecycle: () => {
            const container = Adapters.DOM.find(CONFIG.selectors.PLAYER);
            if (!container) {
                setTimeout(Core.observeLifecycle, CONFIG.timing.RETRY_MS);
                return;
            }

            // Feature #2: Initial Acquisition Flag
            let isInitialAcquisition = true;

            if (Core.observer) Core.observer.disconnect();

            const debouncedAcquire = Fn.debounce(() => {
                Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
            }, CONFIG.timing.INJECTION_MS * 2);

            const handleMutations = (mutations) => {
                let shouldReacquire = isInitialAcquisition;
                if (isInitialAcquisition) isInitialAcquisition = false;

                for (const m of mutations) {
                    if (shouldReacquire) break;

                    if (m.type === 'childList') {
                        const hasVideo = (nodes) => Array.from(nodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO));
                        // Feature #3: Player Element Removal Detection
                        const hasPlayer = (nodes) => Array.from(nodes).some(n => (n.matches && n.matches(CONFIG.selectors.PLAYER)) || (n.closest && n.closest(CONFIG.selectors.PLAYER)));

                        if (hasVideo(m.addedNodes) || hasVideo(m.removedNodes) || hasPlayer(m.removedNodes)) {
                            shouldReacquire = true;
                            break;
                        }
                    }
                    // Feature #3: Attribute mutations scoped to player
                    if (m.type === 'attributes' && m.attributeName === 'class') {
                        if (m.target.closest(CONFIG.selectors.PLAYER)) {
                            shouldReacquire = true;
                            break;
                        }
                    }
                }
                if (shouldReacquire) debouncedAcquire();
            };

            Core.observer = Adapters.DOM.observe(container, handleMutations, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

            // Feature #1: Video Listener Cleanup
            VideoListenerManager.attach(container);
        }
    };

    Core.init();

})();