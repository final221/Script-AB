// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core) - V3.60 PERFORM REVERSION ERROR LOGGING
// @version       3.60
// @description   🛡️ Stealth Reactor Core: Blocks Twitch ads with self-healing and remote configuration.
// @author        Senior Expert AI (Refactored)
// @match         *://*.twitch.tv/*
// @run-at        document-start
// @grant         none
// ==/UserScript==

(function () {
    'use strict';

    /**
     * MEGA AD DODGER 3000 (Refactored v3.60)
     * A monolithic, self-contained userscript for Twitch ad blocking.
     * 
     * CHANGES v3.60:
     * - Restored specific MutationObserver logic to reduce overhead.
     * - Added circular reference protection to PlayerManager.
     * - Refined NetworkShield proxy handling.
     * - Fixed debounce logic in Core.observeLifecycle.
     */

    // ============================================================================
    // 1. CONFIGURATION & CONSTANTS
    // ============================================================================
    const CONFIG = (() => {
        const raw = {
            debug: false,
            security: {
                VERSION_MAJOR: 58,
                VERSION_MINOR: 15,
                SALT: 0x08,
            },
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
                THROTTLE_RESET_MIN: 15,
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

        // Derived Constants
        const NAMESPACE = `PHANTOM_CORE_V${raw.security.VERSION_MAJOR}_0`;

        return Object.freeze({
            ...raw,
            messaging: {
                NAMESPACE,
                EVT_AD_DETECTED: `AD_EVT_V${raw.security.VERSION_MAJOR}_0`,
                EVT_ACQUIRE: `ACQ_EVT_V${raw.security.VERSION_MAJOR}_0`,
                EVT_REPORT: `REP_EVT_V${raw.security.VERSION_MAJOR}_0`,
                EVT_LOG: `LOG_EVT_V${raw.security.VERSION_MAJOR}_0`,
                EVT_REACQUIRE: `REA_EVT_V${raw.security.VERSION_MAJOR}_0`,
            },
            regex: {
                AD_BLOCK: new RegExp(raw.network.AD_PATTERNS.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
                AD_TRIGGER: new RegExp(raw.network.AD_PATTERNS.concat(raw.network.TRIGGER_PATTERNS).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')),
            }
        });
    })();

    // ============================================================================
    // 2. UTILITIES & LOGGING
    // ============================================================================
    const Utils = {
        id: Math.random().toString(36).substring(2, 10),

        log: (...args) => CONFIG.debug && console.log(`[${CONFIG.messaging.NAMESPACE}]`, ...args),
        warn: (...args) => CONFIG.debug && console.warn(`[${CONFIG.messaging.NAMESPACE}]`, ...args),

        reportError: (status, detail) => {
            if (CONFIG.debug) console.error(`[${CONFIG.messaging.NAMESPACE}] ERROR: ${status} - ${detail}`);
            window.postMessage({
                type: Utils.id,
                action: CONFIG.messaging.EVT_LOG,
                status,
                detail,
                time: Date.now()
            }, window.location.origin);
        },

        debounce: (func, delay) => {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), delay);
            };
        },

        // Persistent State (LocalStorage)
        Storage: {
            get: (defaultState) => {
                try {
                    const stored = localStorage.getItem(CONFIG.messaging.NAMESPACE);
                    if (stored) {
                        const state = JSON.parse(stored);
                        if (Date.now() - state.timestamp <= CONFIG.timing.LOG_EXPIRY_MIN * 60 * 1000) {
                            return state;
                        }
                    }
                } catch (e) { /* Ignore */ }
                return defaultState;
            },
            set: (state) => {
                try {
                    state.timestamp = Date.now();
                    localStorage.setItem(CONFIG.messaging.NAMESPACE, JSON.stringify(state));
                } catch (e) { /* Ignore */ }
            }
        }
    };

    // ============================================================================
    // 3. STATE MANAGEMENT
    // ============================================================================
    const State = {
        observer: null,
        videoListener: null,
        logState: Utils.Storage.get({ errorCount: 0, timestamp: 0, lastError: null, lastAttempt: 0 }),

        updateLogState: (updates) => {
            State.logState = { ...State.logState, ...updates };
            Utils.Storage.set(State.logState);
        }
    };

    // ============================================================================
    // 4. NETWORK SHIELD (Intrusion Layer)
    // ============================================================================
    const NetworkShield = {
        shouldBlock: (url) => CONFIG.regex.AD_BLOCK.test(url),
        shouldTrigger: (url) => CONFIG.regex.AD_TRIGGER.test(url),

        init: () => {
            const originalXhrOpen = XMLHttpRequest.prototype.open;
            const originalFetch = window.fetch;

            // Hook XHR
            XMLHttpRequest.prototype.open = new Proxy(originalXhrOpen, {
                apply: (target, thisArg, args) => {
                    const [method, url] = args;
                    if (method === 'GET' && typeof url === 'string') {
                        if (NetworkShield.handleRequest(url)) {
                            NetworkShield.mockXhr(thisArg, url);
                            return;
                        }
                    }
                    return Reflect.apply(target, thisArg, args);
                }
            });

            // Hook Fetch
            window.fetch = new Proxy(originalFetch, {
                apply: (target, thisArg, args) => {
                    const url = (typeof args[0] === 'string') ? args[0] : (args[0] instanceof Request ? args[0].url : '');
                    if (url && NetworkShield.handleRequest(url)) {
                        return Promise.resolve(NetworkShield.createMockResponse(url));
                    }
                    return Reflect.apply(target, thisArg, args);
                }
            });
        },

        handleRequest: (url) => {
            if (NetworkShield.shouldTrigger(url)) {
                window.postMessage({ type: Utils.id, action: CONFIG.messaging.EVT_AD_DETECTED }, window.location.origin);
            }
            return NetworkShield.shouldBlock(url);
        },

        mockXhr: (xhr, url) => {
            const mockBody = url.includes('.m3u8') ? CONFIG.mock.M3U8 : CONFIG.mock.JSON;
            xhr.addEventListener('readystatechange', function inject() {
                if (this.readyState === 2) {
                    Object.defineProperties(this, {
                        responseText: { value: mockBody, writable: false },
                        response: { value: mockBody, writable: false },
                        status: { value: 200, writable: false },
                        statusText: { value: 'OK', writable: false },
                    });
                    this.removeEventListener('readystatechange', inject);
                }
            });
        },

        createMockResponse: (url) => {
            const body = url.includes('.m3u8') ? CONFIG.mock.M3U8 : CONFIG.mock.JSON;
            const type = url.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/json';
            return new Response(body, { status: 200, statusText: 'OK', headers: { 'Content-Type': type } });
        }
    };

    // ============================================================================
    // 5. PLAYER CONTEXT MANAGER (Key Verification)
    // ============================================================================
    const PlayerManager = (() => {
        let cachedContext = null;
        let keyMap = { k0: null, k1: null, k2: null };

        const signatures = [
            { id: 'k0', validate: (o, k) => { try { return o[k](true) == null; } catch { return false; } } }, // Toggle/Mute?
            { id: 'k1', validate: (o, k) => { try { return o[k]() == null; } catch { return false; } } },     // Pause?
            { id: 'k2', validate: (o, k) => { try { return o[k]() == null; } catch { return false; } } }      // Other?
        ];

        const findKey = (obj, sigIndex) => {
            const sig = signatures[sigIndex];
            const cachedKey = keyMap[sig.id];

            // Check cache
            if (cachedKey && obj[cachedKey] && sig.validate(obj, cachedKey)) return true;

            // Search
            for (const key in obj) {
                if (typeof obj[key] === 'function' && sig.validate(obj, key)) {
                    keyMap[sig.id] = key;
                    return true;
                }
            }
            return false;
        };

        const verifyAll = (context) => {
            let valid = true;
            for (let i = 0; i < signatures.length; i++) {
                if (!findKey(context, i)) valid = false;
            }
            return valid;
        };

        const searchRecursive = (obj, depth = 0, visited = new WeakSet()) => {
            if (depth > CONFIG.player.MAX_SEARCH_DEPTH || !obj || typeof obj !== 'object') return null;
            if (visited.has(obj)) return null;

            visited.add(obj);

            if (verifyAll(obj)) return obj;

            for (const k in obj) {
                if (obj[k] && typeof obj[k] === 'object') {
                    const found = searchRecursive(obj[k], depth + 1, visited);
                    if (found) return found;
                }
            }
            return null;
        };

        return {
            getContext: (element) => {
                if (cachedContext) return cachedContext;
                if (!element) return null;

                // React/Vue/Next internals search
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

    // ============================================================================
    // 6. AD COUNTERMEASURE (Reversion Logic)
    // ============================================================================
    const AdCountermeasure = {
        execute: (container) => {
            const player = PlayerManager.getContext(container);
            if (!player) {
                Utils.reportError('REVERT_FAIL', 'No player context');
                return;
            }

            const keys = PlayerManager.getKeys();
            const video = container.querySelector(CONFIG.selectors.VIDEO);

            try {
                // 1. Force Stop
                if (video) { video.src = ''; video.load(); }

                // 2. Execute Player Commands
                setTimeout(() => {
                    try {
                        player[keys.k1]();      // Pause/Stop
                        player[keys.k0](true);  // Toggle/Mute

                        // 3. Force Play with Cache Busting
                        if (video) {
                            const src = video.src;
                            const bust = '?t=' + Math.random().toString(36).substring(2);
                            video.src = '';
                            video.load();
                            setTimeout(() => {
                                video.src = src.split('?')[0] + bust;
                                video.load();
                                video.play();
                            }, CONFIG.timing.FORCE_PLAY_DEFER_MS);
                        }

                        window.postMessage({ type: Utils.id, action: CONFIG.messaging.EVT_REPORT, status: 'SUCCESS' }, window.location.origin);
                    } catch (e) {
                        throw e; // Escalate to fallback
                    }
                }, CONFIG.timing.REVERSION_DELAY_MS);

            } catch (e) {
                AdCountermeasure.fallback(container);
            }
        },

        fallback: (container) => {
            Utils.warn('Reversion failed, attempting DOM replacement fallback.');
            const clone = container.cloneNode(true);
            if (container.parentNode) {
                container.parentNode.replaceChild(clone, container);
                PlayerManager.reset();

                // Attempt to restart playback on new node
                setTimeout(() => {
                    const v = clone.querySelector(CONFIG.selectors.VIDEO);
                    if (v) v.play();
                }, CONFIG.timing.REVERSION_DELAY_MS);
            }
        }
    };

    // ============================================================================
    // 7. HEALTH MONITOR
    // ============================================================================
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
                // Check for stalled/ad state
                if (HealthMonitor.videoRef.readyState < 4 && !HealthMonitor.videoRef.paused && !HealthMonitor.videoRef.ended) {
                    HealthMonitor.stop();
                    window.postMessage({ type: Utils.id, action: CONFIG.messaging.EVT_AD_DETECTED }, '*');
                }
            }, CONFIG.timing.HEALTH_CHECK_MS);
        },

        stop: () => {
            if (HealthMonitor.timer) clearInterval(HealthMonitor.timer);
            HealthMonitor.timer = null;
            HealthMonitor.videoRef = null;
        }
    };

    // ============================================================================
    // 8. CORE ORCHESTRATOR
    // ============================================================================
    const Core = {
        init: () => {
            if (window.self !== window.top) return;

            // Check throttle
            const timeSinceLast = Date.now() - State.logState.lastAttempt;
            if (State.logState.errorCount >= CONFIG.timing.LOG_THROTTLE && timeSinceLast < CONFIG.timing.REATTEMPT_DELAY_MS) {
                Utils.warn('Core throttled.');
                return;
            }

            NetworkShield.init();
            Core.setupMessaging();

            // Delayed injection
            setTimeout(() => {
                Core.inject();
                Core.observeLifecycle();
            }, CONFIG.timing.INJECTION_MS);
        },

        inject: () => {
            State.updateLogState({ lastAttempt: Date.now() });
            window.postMessage({ type: Utils.id, action: CONFIG.messaging.EVT_ACQUIRE }, window.location.origin);
        },

        setupMessaging: () => {
            window.addEventListener('message', (e) => {
                if (e.data?.type !== Utils.id) return;

                switch (e.data.action) {
                    case CONFIG.messaging.EVT_ACQUIRE:
                        const container = document.querySelector(CONFIG.selectors.PLAYER);
                        if (container) {
                            const ctx = PlayerManager.getContext(container);
                            if (ctx) HealthMonitor.start(container);
                        }
                        break;

                    case CONFIG.messaging.EVT_AD_DETECTED:
                        const c = document.querySelector(CONFIG.selectors.PLAYER);
                        if (c) AdCountermeasure.execute(c);
                        break;

                    case CONFIG.messaging.EVT_LOG:
                        const { status, detail } = e.data;
                        const count = State.logState.errorCount + 1;
                        State.updateLogState({ errorCount: count, lastError: `${status}: ${detail}` });
                        if (count < CONFIG.timing.LOG_THROTTLE) {
                            State.updateLogState({ lastAttempt: Date.now() });
                        }
                        break;
                }
            });
        },

        observeLifecycle: () => {
            const container = document.querySelector(CONFIG.selectors.PLAYER);
            if (!container) {
                setTimeout(Core.observeLifecycle, CONFIG.timing.RETRY_MS);
                return;
            }

            if (State.observer) State.observer.disconnect();

            const debouncedAcquire = Utils.debounce(() => {
                window.postMessage({ type: Utils.id, action: CONFIG.messaging.EVT_ACQUIRE }, window.location.origin);
            }, CONFIG.timing.INJECTION_MS * 2);

            const handleMutations = (mutations) => {
                let shouldReacquire = false;

                for (const m of mutations) {
                    // 1. Video Element Added/Removed
                    if (m.type === 'childList') {
                        const videoChanged = Array.from(m.addedNodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO)) ||
                            Array.from(m.removedNodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO));
                        if (videoChanged) {
                            shouldReacquire = true;
                            break;
                        }
                    }

                    // 2. Player Class Changed (often indicates state change like ad-break start/end)
                    if (m.type === 'attributes' && m.attributeName === 'class') {
                        shouldReacquire = true;
                        break;
                    }
                }

                if (shouldReacquire) {
                    debouncedAcquire();
                }
            };

            State.observer = new MutationObserver(handleMutations);
            State.observer.observe(container, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            // Video Load Listener
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (video) {
                video.addEventListener('loadstart', () => {
                    window.postMessage({ type: Utils.id, action: CONFIG.messaging.EVT_ACQUIRE }, window.location.origin);
                });
            }
        }
    };

    // Start
    Core.init();

})();