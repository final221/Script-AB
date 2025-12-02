// ==UserScript==
// @name          Mega Ad Dodger 3000 (Stealth Reactor Core)
// @version       2.2.4
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
            LOG_THROTTLE: 5,
            LOG_EXPIRY_MIN: 5,
            REVERSION_DELAY_MS: 100,
            FORCE_PLAY_DEFER_MS: 1,
            REATTEMPT_DELAY_MS: 60 * 1000,
            PLAYBACK_TIMEOUT_MS: 2500,
            FRAME_DROP_SEVERE_THRESHOLD: 500,
            FRAME_DROP_MODERATE_THRESHOLD: 100,
            FRAME_DROP_RATE_THRESHOLD: 30,
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
            STUCK_THRESHOLD_S: 0.1,
            STUCK_COUNT_LIMIT: 2,
            STANDARD_SEEK_BACK_S: 3.5,
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
const Logic = (() => {
    return {
        Network: {
            // Helper: Safe URL parsing with fallback
            _parseUrl: (url) => {
                try {
                    return new URL(url);
                } catch (e) {
                    // Fallback for relative URLs (e.g. "/ad/v1/")
                    try {
                        return new URL(url, 'http://twitch.tv');
                    } catch (e2) {
                        // Fallback for truly malformed input
                        Logger.add('[Logic] URL parse failed, using string matching', { url, error: String(e2) });
                        return null;
                    }
                }
            },

            // Helper: Check if pattern matches URL pathname (not query/hash)
            _pathMatches: (url, pattern) => {
                const parsed = Logic.Network._parseUrl(url);
                if (parsed) {
                    // Match against pathname only (ignore query and hash)
                    return parsed.pathname.includes(pattern);
                }
                // Fallback: use string matching on full URL
                return url.includes(pattern);
            },

            isAd: (url) => {
                if (!url || typeof url !== 'string') return false;
                return CONFIG.regex.AD_BLOCK.test(url);
            },

            isTrigger: (url) => {
                if (!url || typeof url !== 'string') return false;
                return CONFIG.regex.AD_TRIGGER.test(url);
            },

            isDelivery: (url) => {
                if (!url || typeof url !== 'string') return false;

                // Check delivery patterns against pathname only
                const hasDelivery = CONFIG.network.DELIVERY_PATTERNS.some(p =>
                    Logic.Network._pathMatches(url, p)
                );

                // Ensure it's NOT just an availability check
                const isAvailability = CONFIG.network.AVAILABILITY_PATTERNS.some(p => {
                    const parsed = Logic.Network._parseUrl(url);
                    if (parsed) {
                        // For query param patterns (bp=preroll), check search params
                        if (p.includes('=')) {
                            return parsed.search.includes(p);
                        }
                        // For path patterns, check pathname
                        return parsed.pathname.includes(p);
                    }
                    return url.includes(p);
                });

                return hasDelivery && !isAvailability;
            },

            isAvailabilityCheck: (url) => {
                if (!url || typeof url !== 'string') return false;

                return CONFIG.network.AVAILABILITY_PATTERNS.some(p => {
                    const parsed = Logic.Network._parseUrl(url);
                    if (parsed) {
                        // Query param patterns
                        if (p.includes('=')) {
                            return parsed.search.includes(p);
                        }
                        // Path patterns
                        return parsed.pathname.includes(p);
                    }
                    return url.includes(p);
                });
            },

            getMock: (url) => {
                if (!url || typeof url !== 'string') {
                    return { body: CONFIG.mock.JSON, type: 'application/json' };
                }

                const parsed = Logic.Network._parseUrl(url);
                const pathname = parsed ? parsed.pathname : url;

                // Check file extension in pathname only (not query params)
                if (pathname.endsWith('.m3u8')) {
                    return { body: CONFIG.mock.M3U8, type: 'application/vnd.apple.mpegurl' };
                }
                if (pathname.includes('vast') || pathname.endsWith('.xml')) {
                    return { body: CONFIG.mock.VAST, type: 'application/xml' };
                }
                return { body: CONFIG.mock.JSON, type: 'application/json' };
            },

            // Track unknown suspicious URLs
            _suspiciousUrls: new Set(),
            _suspiciousKeywords: [
                'ad', 'ads', 'advertisement', 'preroll', 'midroll',
                'doubleclick', 'pubads', 'vast', 'tracking', 'analytics'
            ],

            /**
             * Detect potentially new ad patterns
             * Logs URLs that look like ads but don't match existing patterns
             */
            detectNewPatterns: (url) => {
                if (!url || typeof url !== 'string') return;

                // Skip if already matches known patterns
                if (Logic.Network.isAd(url)) return;
                if (Logic.Network.isTrigger(url)) return;

                const urlLower = url.toLowerCase();
                const parsed = Logic.Network._parseUrl(url);

                // Check if URL contains suspicious keywords
                const hasSuspiciousKeyword = Logic.Network._suspiciousKeywords.some(keyword =>
                    urlLower.includes(keyword)
                );

                if (hasSuspiciousKeyword && !Logic.Network._suspiciousUrls.has(url)) {
                    Logic.Network._suspiciousUrls.add(url);

                    // ✅ This gets exported with exportTwitchAdLogs()
                    Logger.add('[PATTERN DISCOVERY] Suspicious URL detected', {
                        url,
                        pathname: parsed ? parsed.pathname : 'parse failed',
                        hostname: parsed ? parsed.hostname : 'parse failed',
                        keywords: Logic.Network._suspiciousKeywords.filter(k => urlLower.includes(k)),
                        suggestion: 'Review this URL - might be a new ad pattern'
                    });
                }
            },

            // Export discovered patterns for review
            getDiscoveredPatterns: () => Array.from(Logic.Network._suspiciousUrls)
        },
        Player: {
            // Session-based signature tracking
            _sessionSignatures: {
                sessionId: null,
                mountTime: null,
                k0: null,
                k1: null,
                k2: null,
                keyHistory: []
            },

            // Initialize new session
            startSession: () => {
                const sessionId = `session-${Date.now()}`;
                Logic.Player._sessionSignatures = {
                    sessionId,
                    mountTime: Date.now(),
                    k0: null,
                    k1: null,
                    k2: null,
                    keyHistory: []
                };
                Logger.add('[Logic] New player session started', { sessionId });
            },

            // End session
            endSession: () => {
                const session = Logic.Player._sessionSignatures;
                if (!session.sessionId) return;

                Logger.add('[Logic] Player session ended', {
                    sessionId: session.sessionId,
                    duration: Date.now() - session.mountTime,
                    finalKeys: {
                        k0: session.k0,
                        k1: session.k1,
                        k2: session.k2
                    },
                    keyChanges: session.keyHistory.length
                });

                if (session.keyHistory.length > 0) {
                    Logger.add('[Logic] ⚠️ ALERT: Signature keys changed during session', {
                        sessionId: session.sessionId,
                        changes: session.keyHistory
                    });
                }
            },

            // Get current session status
            getSessionStatus: () => {
                const session = Logic.Player._sessionSignatures;
                return {
                    sessionId: session.sessionId,
                    uptime: session.mountTime ? Date.now() - session.mountTime : 0,
                    currentKeys: {
                        k0: session.k0,
                        k1: session.k1,
                        k2: session.k2
                    },
                    totalChanges: session.keyHistory.length,
                    recentChanges: session.keyHistory.slice(-5),
                    allKeysSet: !!(session.k0 && session.k1 && session.k2)
                };
            },

            // Check if session is unstable
            isSessionUnstable: () => {
                const session = Logic.Player._sessionSignatures;

                const hourAgo = Date.now() - 3600000;
                const recentChanges = session.keyHistory.filter(c => c.timestamp > hourAgo);

                const isUnstable = recentChanges.length > 3;

                if (isUnstable) {
                    Logger.add('[Logic] ⚠️ ALERT: Signature session UNSTABLE', {
                        changesInLastHour: recentChanges.length,
                        threshold: 3,
                        suggestion: 'Twitch may have updated player - patterns may break soon'
                    });
                }

                return isUnstable;
            },

            signatures: [
                {
                    id: 'k0',
                    check: (o, k) => {
                        try {
                            const result = typeof o[k] === 'function' && o[k].length === 1;

                            if (result) {
                                const session = Logic.Player._sessionSignatures;

                                // Check if key changed within this session
                                if (session.k0 && session.k0 !== k) {
                                    const change = {
                                        timestamp: Date.now(),
                                        signatureId: 'k0',
                                        oldKey: session.k0,
                                        newKey: k,
                                        timeSinceMount: Date.now() - session.mountTime
                                    };

                                    session.keyHistory.push(change);
                                    Logger.add('[Logic] ⚠️ SIGNATURE KEY CHANGED DURING SESSION', change);
                                }

                                // Update session key
                                if (!session.k0 || session.k0 !== k) {
                                    session.k0 = k;
                                    Logger.add('[Logic] Signature k0 key set', {
                                        key: k,
                                        sessionId: session.sessionId,
                                        isChange: session.k0 !== null
                                    });
                                }
                            }

                            return result;
                        } catch (e) {
                            return false;
                        }
                    }
                },
                {
                    id: 'k1',
                    check: (o, k) => {
                        try {
                            const result = typeof o[k] === 'function' && o[k].length === 0;

                            if (result) {
                                const session = Logic.Player._sessionSignatures;

                                if (session.k1 && session.k1 !== k) {
                                    const change = {
                                        timestamp: Date.now(),
                                        signatureId: 'k1',
                                        oldKey: session.k1,
                                        newKey: k,
                                        timeSinceMount: Date.now() - session.mountTime
                                    };

                                    session.keyHistory.push(change);
                                    Logger.add('[Logic] ⚠️ SIGNATURE KEY CHANGED DURING SESSION', change);
                                }

                                if (!session.k1 || session.k1 !== k) {
                                    session.k1 = k;
                                    Logger.add('[Logic] Signature k1 key set', {
                                        key: k,
                                        sessionId: session.sessionId,
                                        isChange: session.k1 !== null
                                    });
                                }
                            }

                            return result;
                        } catch (e) {
                            return false;
                        }
                    }
                },
                {
                    id: 'k2',
                    check: (o, k) => {
                        try {
                            const result = typeof o[k] === 'function' && o[k].length === 0;

                            if (result) {
                                const session = Logic.Player._sessionSignatures;

                                if (session.k2 && session.k2 !== k) {
                                    const change = {
                                        timestamp: Date.now(),
                                        signatureId: 'k2',
                                        oldKey: session.k2,
                                        newKey: k,
                                        timeSinceMount: Date.now() - session.mountTime
                                    };

                                    session.keyHistory.push(change);
                                    Logger.add('[Logic] ⚠️ SIGNATURE KEY CHANGED DURING SESSION', change);
                                }

                                if (!session.k2 || session.k2 !== k) {
                                    session.k2 = k;
                                    Logger.add('[Logic] Signature k2 key set', {
                                        key: k,
                                        sessionId: session.sessionId,
                                        isChange: session.k2 !== null
                                    });
                                }
                            }

                            return result;
                        } catch (e) {
                            return false;
                        }
                    }
                }
            ],
            validate: (obj, key, sig) => Fn.tryCatch(() => typeof obj[key] === 'function' && sig.check(obj, key), () => false)(),

            // Export stats summary (for debugging - backward compatibility)
            getSignatureStats: () => Logic.Player.getSessionStatus()
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

// --- Event Coordinator ---
/**
 * Sets up EventBus listeners and coordinates event responses.
 * @responsibility Wire up global event listeners for ACQUIRE and AD_DETECTED.
 */
const EventCoordinator = (() => {
    return {
        init: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, (payload) => {
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    if (PlayerContext.get(container)) {
                        Logger.add('[LIFECYCLE] Event: ACQUIRE - Success', payload);
                        HealthMonitor.start(container);
                    } else {
                        Logger.add('[LIFECYCLE] Event: ACQUIRE - Failed', payload);
                    }
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
                // Enhanced logging with source and trigger context
                if (payload?.source) {
                    const triggerInfo = payload.trigger ? ` | Trigger: ${payload.trigger}` : '';
                    const reasonInfo = payload.reason ? ` | Reason: ${payload.reason}` : '';
                    Logger.add(`[EVENT] AD_DETECTED | Source: ${payload.source}${triggerInfo}${reasonInfo}`, payload.details || {});
                } else {
                    // Fallback for events without payload (backward compatibility)
                    Logger.add('[EVENT] AD_DETECTED | Source: UNKNOWN');
                }

                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    ResilienceOrchestrator.execute(container, payload);
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

            // Start signature session tracking
            Logic.Player.startSession();

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

            // End signature session tracking
            Logic.Player.endSession();

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
                Logger.add('[HEALTH] A/V sync issue detected', {
                    discrepancy: (discrepancy * 1000).toFixed(2) + 'ms',
                    count: state.syncIssueCount,
                });
            } else if (discrepancy < CONFIG.timing.AV_SYNC_THRESHOLD_MS / 2000) {
                if (state.syncIssueCount > 0) {
                    Logger.add('[HEALTH] A/V sync recovered', { previousIssues: state.syncIssueCount });
                    state.syncIssueCount = 0;
                }
            }

            if (state.syncIssueCount >= 3) {
                const discrepancyMs = discrepancy * 1000;
                let severity = 'minor';
                if (discrepancyMs >= 10000) severity = 'critical';
                else if (discrepancyMs >= 3000) severity = 'severe';
                else if (discrepancyMs >= 1000) severity = 'moderate';

                Logger.add('[HEALTH] A/V sync threshold exceeded', {
                    syncIssueCount: state.syncIssueCount,
                    threshold: 3,
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    severity
                });
                state.lastSyncCheckTime = now;
                state.lastSyncVideoTime = video.currentTime;
                return {
                    reason: 'Persistent A/V sync issue',
                    details: {
                        syncIssueCount: state.syncIssueCount,
                        discrepancy: discrepancyMs,
                        threshold: 3,
                        severity
                    }
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

// --- Frame Drop Detector ---
/**
 * Monitors video frame drops to detect playback quality issues.
 * @responsibility Track dropped frames and trigger recovery on severe drops.
 */
const FrameDropDetector = (() => {
    let state = {
        lastDroppedFrames: 0,
        lastTotalFrames: 0,
        lastCurrentTime: -1,
        lastCheckTimestamp: 0
    };

    const reset = () => {
        state.lastDroppedFrames = 0;
        state.lastTotalFrames = 0;
        state.lastCurrentTime = -1;
        state.lastCheckTimestamp = 0;
    };

    const validatePlaybackProgression = (video) => {
        const now = Date.now();
        const timeSinceLastCheck = now - state.lastCheckTimestamp;

        // First check or reset
        if (state.lastCurrentTime === -1) {
            state.lastCurrentTime = video.currentTime;
            state.lastCheckTimestamp = now;
            return true; // Assume playing until proven otherwise
        }

        const timeAdvanced = video.currentTime - state.lastCurrentTime;
        // Expected advance is 90% of real time to account for minor variances
        const expectedAdvance = (timeSinceLastCheck / 1000) * 0.9;

        // Update state for next check
        state.lastCurrentTime = video.currentTime;
        state.lastCheckTimestamp = now;

        // If time advanced sufficiently, video is playing
        if (timeAdvanced >= expectedAdvance) {
            return true;
        }

        // Allow for seeking or buffering states
        if (video.seeking || video.readyState < 3) {
            return true;
        }

        return false; // Video is actually stuck
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
            Logger.add('[HEALTH] Frame drop detected', {
                newDropped,
                newTotal,
                recentDropRate: recentDropRate.toFixed(2) + '%'
            });

            const exceedsSevere = newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD;
            const exceedsModerate = newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD &&
                recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD;

            if (exceedsSevere || exceedsModerate) {
                // CRITICAL FIX: Validate video is actually stuck before triggering
                const isActuallyPlaying = validatePlaybackProgression(video);

                if (isActuallyPlaying) {
                    Logger.add('[HEALTH] Frame drops detected but video is playing normally - ignoring', {
                        dropped: newDropped,
                        currentTime: video.currentTime
                    });
                    // Update baseline so we don't re-trigger on these frames
                    state.lastDroppedFrames = quality.droppedVideoFrames;
                    state.lastTotalFrames = quality.totalVideoFrames;
                    return null;
                }

                const severity = exceedsSevere ? 'SEVERE' : 'MODERATE';
                Logger.add(`[HEALTH] Frame drop threshold exceeded | Severity: ${severity}`, {
                    newDropped,
                    threshold: exceedsSevere ? CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD : CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD,
                    recentDropRate
                });

                state.lastDroppedFrames = quality.droppedVideoFrames;
                state.lastTotalFrames = quality.totalVideoFrames;
                return {
                    reason: `${severity} frame drop`,
                    details: { newDropped, newTotal, recentDropRate, severity }
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

    // State tracking
    let isPaused = false;
    let lastTriggerTime = 0;
    const COOLDOWN_MS = 5000; // 5 seconds
    let pendingIssues = [];

    const triggerRecovery = (reason, details, triggerType) => {
        // Cooldown check
        const now = Date.now();
        if (now - lastTriggerTime < COOLDOWN_MS) {
            Logger.add('[HEALTH] Trigger skipped - cooldown active', {
                timeSinceLast: (now - lastTriggerTime) / 1000
            });
            return;
        }

        Logger.add(`[HEALTH] Recovery trigger | Reason: ${reason}, Type: ${triggerType}`, details);
        Metrics.increment('health_triggers');

        lastTriggerTime = now;
        HealthMonitor.pause(); // Pause instead of stop

        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
            source: 'HEALTH',
            trigger: triggerType,
            reason: reason,
            details: details
        });
    };

    const runMainChecks = () => {
        if (!videoRef || !document.body.contains(videoRef) || isPaused) {
            return;
        }

        // Accumulate all issues
        const stuckResult = StuckDetector.check(videoRef);
        if (stuckResult) {
            pendingIssues.push({ type: 'STUCK_PLAYBACK', priority: 3, ...stuckResult });
        }

        const frameDropResult = FrameDropDetector.check(videoRef);
        if (frameDropResult) {
            pendingIssues.push({ type: 'FRAME_DROP', priority: 2, ...frameDropResult });
        }

        // Process issues if any found
        if (pendingIssues.length > 0) {
            // Sort by priority (highest first)
            pendingIssues.sort((a, b) => b.priority - a.priority);

            const topIssue = pendingIssues[0];
            if (pendingIssues.length > 1) {
                Logger.add('[HEALTH] Multiple issues detected, triggering for highest priority', {
                    allIssues: pendingIssues.map(i => i.type),
                    selected: topIssue.type
                });
            }

            triggerRecovery(topIssue.reason, topIssue.details, topIssue.type);
            pendingIssues = []; // Clear
        }
    };

    const runSyncCheck = () => {
        if (!videoRef || !document.body.contains(videoRef) || isPaused) {
            return;
        }

        // Check A/V sync
        const syncResult = AVSyncDetector.check(videoRef);
        if (syncResult) {
            pendingIssues.push({ type: 'AV_SYNC', priority: 1, ...syncResult });

            // A/V sync is lowest priority - only trigger if no other issues pending
            // We use a small timeout to allow main checks to run if they happen simultaneously
            setTimeout(() => {
                if (pendingIssues.some(i => i.type === 'AV_SYNC') && !isPaused) {
                    const avIssue = pendingIssues.find(i => i.type === 'AV_SYNC');
                    triggerRecovery(avIssue.reason, avIssue.details, 'AV_SYNC');
                    pendingIssues = [];
                }
            }, 100);
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

            // Auto-resume on recovery completion
            Adapters.EventBus.on(CONFIG.events.REPORT, (payload) => {
                if (payload.status === 'SUCCESS' || payload.status === 'FAILED') {
                    Logger.add('[HEALTH] Recovery completed, resuming monitoring');
                    HealthMonitor.resume();
                }
            });
        },

        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            videoRef = null;
            isPaused = false;
            lastTriggerTime = 0; // Reset cooldown
            StuckDetector.reset();
            FrameDropDetector.reset();
            AVSyncDetector.reset();
        },

        pause: () => {
            if (isPaused) return;

            Logger.add('[HEALTH] Monitoring paused');
            isPaused = true;

            // Auto-resume after timeout as safety net
            setTimeout(() => {
                if (isPaused) {
                    Logger.add('[HEALTH] Auto-resuming after recovery timeout');
                    HealthMonitor.resume();
                }
            }, 15000);
        },

        resume: () => {
            if (!isPaused) return;

            Logger.add('[HEALTH] Monitoring resumed');
            isPaused = false;

            if (videoRef) {
                StuckDetector.reset(videoRef);
                FrameDropDetector.reset();
                AVSyncDetector.reset(videoRef);
            }
        }
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

        // Skip if actively buffering (readyState < 3: HAVE_FUTURE_DATA)
        if (video.readyState < 3) {
            if (CONFIG.debug) {
                Logger.add('StuckDetector: Skipping check - buffering', {
                    readyState: video.readyState
                });
            }
            state.stuckCount = 0;
            state.lastTime = video.currentTime;
            return null;
        }

        // Skip if seeking
        if (video.seeking) {
            if (CONFIG.debug) {
                Logger.add('StuckDetector: Skipping check - seeking');
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
            Logger.add('[HEALTH] Stuck threshold exceeded', {
                stuckCount: state.stuckCount,
                threshold: CONFIG.player.STUCK_COUNT_LIMIT,
                lastTime,
                currentTime
            });
            return {
                reason: 'Player stuck',
                details: { stuckCount: state.stuckCount, lastTime, currentTime, threshold: CONFIG.player.STUCK_COUNT_LIMIT }
            };
        }

        return null;
    };

    return {
        reset,
        check
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
 * Uses structured error classification instead of string pattern matching.
 * @responsibility Observes system-wide events, classifies errors by type and severity.
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;

    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            const classification = classifyError(event.error, event.message || '');

            Logger.add('Global Error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                severity: classification.severity,
                action: classification.action
            });

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }

            if (classification.action === 'TRIGGER_RECOVERY') {
                Logger.add('Critical error detected, triggering recovery');
                setTimeout(() => Adapters.EventBus.emit(CONFIG.events.AD_DETECTED), 300);
            }
        });

        window.addEventListener('unhandledrejection', (event) => {
            Logger.add('Unhandled Rejection', {
                reason: event.reason ? event.reason.toString() : 'Unknown',
                severity: 'MEDIUM'
            });
            Metrics.increment('errors');
        });
    };

    const interceptConsoleError = () => {
        const originalError = console.error;

        console.error = (...args) => {
            originalError.apply(console, args);
            try {
                const msg = args.map(String).join(' ');
                const classification = classifyError(null, msg);

                Logger.add('Console Error', {
                    args: args.map(String),
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
        const stallingDebounced = Fn.debounce(() => {
            Logger.add('Critical warning: Playhead stalling (debounced)');
            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
        }, 10000);

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                const msg = args.map(String).join(' ');

                // Critical playback warning
                if (msg.toLowerCase().includes('playhead stalling')) {
                    Logger.add('Playhead stalling warning detected (raw)', { severity: 'CRITICAL' });
                    stallingDebounced();
                }
                // CSP warnings (informational)
                else if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                    Logger.add('CSP Warning', { args: args.map(String), severity: 'LOW' });
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
        getLogs: () => logs, // Expose logs for testing/debugging
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
 * 2. Emit AD_DETECTED only for actual ad delivery (not availability checks).
 * 3. Update Metrics.
 */
const AdBlocker = (() => {
    // Correlation tracking
    let lastAdDetectionTime = 0;
    let recoveryTriggersWithoutAds = 0;

    const process = (url, type) => {
        // 1. Input Validation
        if (!url || typeof url !== 'string') {
            Logger.debug('[NETWORK] Invalid URL passed to AdBlocker', { url, type });
            return false;
        }

        // 2. Pattern Discovery (Always run)
        Logic.Network.detectNewPatterns(url);

        let isAd = false;
        let isTrigger = false;

        // 3. Check Trigger First (Subset of Ads)
        if (Logic.Network.isTrigger(url)) {
            isTrigger = true;
            isAd = true; // Triggers are always ads

            const isDelivery = Logic.Network.isDelivery(url);
            const triggerCategory = isDelivery ? 'Ad Delivery' : 'Availability Check';

            Logger.add(`[NETWORK] Trigger pattern detected | Category: ${triggerCategory}`, {
                type,
                url,
                isDelivery
            });

            // Only emit AD_DETECTED for actual ad delivery
            if (isDelivery) {
                lastAdDetectionTime = Date.now();

                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'NETWORK',
                    trigger: 'AD_DELIVERY',
                    reason: 'Ad delivery pattern matched',
                    details: { url, type }
                });
            }
        }
        // 4. Check Generic Ad (if not already identified as trigger)
        else if (Logic.Network.isAd(url)) {
            isAd = true;
            Logger.add('[NETWORK] Ad pattern detected', { type, url });
        }

        // 5. Unified Metrics
        if (isAd) {
            Metrics.increment('ads_detected');
        }

        return isAd;
    };

    // Listen for health-triggered recoveries to detect missed ads
    const initCorrelationTracking = () => {
        // 1. Listen for Health Triggers
        Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
            if (payload.source === 'HEALTH') {
                // Health monitor triggered recovery
                const timeSinceLastAd = Date.now() - lastAdDetectionTime;

                // If > 10 seconds since last network detection, could be a missed ad
                if (timeSinceLastAd > 10000) {
                    recoveryTriggersWithoutAds++;

                    Logger.add('[CORRELATION] Recovery triggered without recent ad detection', {
                        trigger: payload.trigger,
                        reason: payload.reason,
                        timeSinceLastNetworkAd: (timeSinceLastAd / 1000).toFixed(1) + 's',
                        totalMissedCount: recoveryTriggersWithoutAds,
                        suggestion: 'Possible missed ad pattern or legitimate stuck state'
                    });
                }
            }
        });

        // 2. Listen for Log/Report Requests
        Adapters.EventBus.on(CONFIG.events.LOG, () => {
            generateCorrelationReport();
        });
    };

    const generateCorrelationReport = () => {
        const adsDetected = Metrics.get('ads_detected');
        const healthTriggers = Metrics.get('health_triggers');

        const report = {
            ads_detected_network: adsDetected,
            health_triggered_recoveries: healthTriggers,
            recoveries_without_ads: recoveryTriggersWithoutAds,
            detection_accuracy: healthTriggers > 0 ?
                ((adsDetected / healthTriggers) * 100).toFixed(1) + '%' : 'N/A',
            interpretation: healthTriggers > adsDetected * 1.5 ?
                'ALERT: Health triggers significantly exceed ad detections - patterns may be incomplete' :
                'Normal: Ad detection appears accurate'
        };

        Logger.add('[CORRELATION] Statistical report', report);
        return report;
    };

    return {
        process,
        init: initCorrelationTracking,

        // Get correlation stats
        getCorrelationStats: () => ({
            lastAdDetectionTime,
            recoveryTriggersWithoutAds,
            ratio: recoveryTriggersWithoutAds > 0 ?
                recoveryTriggersWithoutAds / (Metrics.get('ads_detected') || 1) : 0
        })
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

                // Auto-detect potential new patterns
                Logic.Network.detectNewPatterns(url);

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

                // Auto-detect potential new patterns
                Logic.Network.detectNewPatterns(url);

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
    let cachedRootElement = null; // Track the DOM element for validation
    let keyMap = { k0: null, k1: null, k2: null };
    const contextHintKeywords = ['react', 'vue', 'next', 'props', 'fiber', 'internal'];
    const fallbackSelectors = ['.video-player__container', '.highwind-video-player', '[data-a-target="video-player"]'];

    /**
     * Detects player function signatures in an object.
     * Attempts to match object properties against known player method signatures.
     * @param {Object} obj - Object to scan for player signatures
     * @returns {boolean} True if all required signatures were found
     */
    const detectPlayerSignatures = (obj) => {
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

    /**
     * Recursively traverses object tree to find the player context using Breadth-First Search (BFS).
     * Searches for React/Vue internal player component instance.
     * @param {Object} rootObj - Object to traverse
     * @returns {Object|null} Player context object if found, null otherwise
     */
    const traverseForPlayerContext = (rootObj) => {
        const queue = [{ node: rootObj, depth: 0 }];
        const visited = new WeakSet();

        while (queue.length > 0) {
            const { node, depth } = queue.shift();

            if (depth > CONFIG.player.MAX_SEARCH_DEPTH) continue;
            if (!node || typeof node !== 'object' || visited.has(node)) continue;

            visited.add(node);

            if (detectPlayerSignatures(node)) {
                return node;
            }

            // Add children to queue
            for (const key of Object.keys(node)) {
                queue.push({ node: node[key], depth: depth + 1 });
            }
        }
        return null;
    };

    const findContextFallback = () => {
        for (const selector of fallbackSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const key = Object.keys(el).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
                if (key && el[key]) {
                    const ctx = traverseForPlayerContext(el[key]);
                    if (ctx) return { ctx, element: el };
                }
            }
        }
        return null;
    };

    /**
     * Validates the cached context to ensure it's still usable.
     * @returns {boolean} True if cache is valid, false otherwise
     */
    const validateCache = () => {
        if (!cachedContext) return false;

        // 1. DOM Attachment Check
        if (cachedRootElement && !cachedRootElement.isConnected) {
            Logger.add('PlayerContext: Cache invalid - Root element detached from DOM');
            PlayerContext.reset();
            return false;
        }

        // 2. Signature Function Check
        const signaturesValid = Object.keys(keyMap).every(
            (key) => keyMap[key] && typeof cachedContext[keyMap[key]] === 'function'
        );

        if (!signaturesValid) {
            Logger.add('PlayerContext: Cache invalid - Signatures missing', { keyMap });
            PlayerContext.reset();
            return false;
        }

        // 3. Liveness Check (safe property access)
        try {
            // Test that context is actually accessible
            const testKey = keyMap.k0;
            if (testKey && cachedContext[testKey]) {
                // Context appears alive
            }
        } catch (e) {
            Logger.add('PlayerContext: Cache invalid - Liveness check failed', { error: String(e) });
            PlayerContext.reset();
            return false;
        }

        return true;
    };

    return {
        /**
         * Get player context for a DOM element
         * @param {HTMLElement} element - Player container element
         * @returns {Object|null} Player context object, or null if not found
         * @important Calling code MUST check for null before using returned object
         */
        get: (element) => {
            // Check if element is different from cached root
            if (element && cachedRootElement && element !== cachedRootElement) {
                Logger.add('PlayerContext: New element provided, resetting cache');
                PlayerContext.reset();
            }

            if (validateCache()) {
                return cachedContext;
            }
            if (!element) return null;

            // 1. Primary Strategy: Keyword Search on Root Element
            // Use Reflect.ownKeys to include Symbol properties, which React often uses.
            const keys = Reflect.ownKeys(element);

            for (const key of keys) {
                const keyString = String(key).toLowerCase();
                if (contextHintKeywords.some(hint => keyString.includes(hint))) {
                    const potentialContext = element[key];
                    if (potentialContext && typeof potentialContext === 'object') {
                        const ctx = traverseForPlayerContext(potentialContext);
                        if (ctx) {
                            cachedContext = ctx;
                            cachedRootElement = element;
                            Logger.add('PlayerContext: Success', { method: 'keyword', key: String(key) });
                            return ctx;
                        }
                    }
                }
            }

            // 2. Fallback Strategy: DOM Selectors
            const fallbackResult = findContextFallback();
            if (fallbackResult) {
                cachedContext = fallbackResult.ctx;
                cachedRootElement = fallbackResult.element;
                Logger.add('PlayerContext: Success', { method: 'fallback', element: fallbackResult.element });
                return fallbackResult.ctx;
            }

            Logger.add('PlayerContext: Scan failed - no context found');
            return null;
        },
        reset: () => {
            cachedContext = null;
            cachedRootElement = null;
            keyMap = { k0: null, k1: null, k2: null };
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
            Logger.add('Executing aggressive recovery: waiting for player to stabilize');
            const recoveryStartTime = performance.now();

            // Log initial telemetry
            const initialState = RecoveryUtils.captureVideoState(video);
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            Logger.add('Aggressive recovery telemetry', {
                strategy: 'PASSIVE_WAIT',
                url: originalSrc,
                isBlobUrl,
                telemetry: initialState
            });

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;

            // CRITICAL: DO NOT seek, DO NOT reload, DO NOT touch the src!
            // Analysis of logs showed that ANY manipulation (seeking to infinity, bufferEnd+5s, etc.)
            // causes massive A/V desync (100+ seconds) or AbortErrors.
            // The player is smart enough to recover on its own. Our job is to just wait.
            // This is the approach from the early version that worked reliably.

            // Wait for stream to be ready (with forensic logging)
            await RecoveryUtils.waitForStability(video, {
                startTime: recoveryStartTime,
                timeoutMs: CONFIG.timing.PLAYBACK_TIMEOUT_MS,
                checkIntervalMs: READY_CHECK_INTERVAL_MS
            });

            // Restore video state
            try {
                video.playbackRate = playbackRate;
                video.volume = volume;
                video.muted = muted;
            } catch (e) {
                Logger.add('Failed to restore video state', { error: e.message });
            }
        }
    };
})();

/**
 * Specialized recovery strategy for A/V synchronization issues.
 * Implements a graduated approach to minimize user disruption while ensuring fix.
 */
const AVSyncRecovery = (() => {
    const SEVERITY = {
        MINOR: 'minor',       // < 1000ms
        MODERATE: 'moderate', // 1000-3000ms
        SEVERE: 'severe',     // 3000-10000ms
        CRITICAL: 'critical'  // > 10000ms
    };

    const classifySeverity = (discrepancyMs) => {
        if (discrepancyMs < 1000) return SEVERITY.MINOR;
        if (discrepancyMs < 3000) return SEVERITY.MODERATE;
        if (discrepancyMs < 10000) return SEVERITY.SEVERE;
        return SEVERITY.CRITICAL;
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const level2_pauseResume = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 2: Pause/Resume attempt');
        try {
            video.pause();
            await sleep(500); // Allow decoders to stabilize
            await video.play();
            return { level: 2, success: true, remainingDesync: 0 }; // Assume fixed for now, verification happens next cycle
        } catch (e) {
            Logger.add('[AV_SYNC] Level 2 failed', { error: e.message });
            return { level: 2, success: false, remainingDesync: discrepancy };
        }
    };

    const level3_seek = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 3: Seek to current position');
        try {
            const pos = video.currentTime;
            video.currentTime = pos + 0.1; // Force seek to reset decoder
            // Wait for seek to complete? usually handled by player events, but we'll return success
            return { level: 3, success: true, remainingDesync: 0 };
        } catch (e) {
            Logger.add('[AV_SYNC] Level 3 failed', { error: e.message });
            return { level: 3, success: false, remainingDesync: discrepancy };
        }
    };

    const level4_reload = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 4: Full reload via video.load()');
        try {
            const pos = video.currentTime;
            const src = video.src;

            // Basic reload sequence
            video.src = '';
            video.load();
            video.src = src;
            video.currentTime = pos;
            await video.play();

            return { level: 4, success: true, remainingDesync: 0 };
        } catch (e) {
            Logger.add('[AV_SYNC] Level 4 failed', { error: e.message });
            return { level: 4, success: false, remainingDesync: discrepancy };
        }
    };

    return {
        execute: async (video, discrepancy) => {
            const startTime = performance.now();
            const severity = classifySeverity(discrepancy);

            Logger.add('[AV_SYNC] Recovery initiated', {
                discrepancy: discrepancy.toFixed(2) + 'ms',
                severity,
                currentTime: video.currentTime
            });

            if (severity === SEVERITY.MINOR) {
                Logger.add('[AV_SYNC] Level 1: Ignoring minor desync');
                return;
            }

            let result;
            if (severity === SEVERITY.MODERATE) {
                Metrics.increment('av_sync_level2_attempts');
                result = await level2_pauseResume(video, discrepancy);
            } else if (severity === SEVERITY.SEVERE) {
                Metrics.increment('av_sync_level3_attempts');
                result = await level3_seek(video, discrepancy);
            } else {
                Metrics.increment('av_sync_level4_attempts');
                result = await level4_reload(video, discrepancy);
            }

            const duration = performance.now() - startTime;
            Logger.add('[AV_SYNC] Recovery complete', {
                level: result.level,
                success: result.success,
                duration: duration.toFixed(2) + 'ms',
                remainingDesync: result.remainingDesync // Note: This is estimated, actual verification is next cycle
            });

            if (!result.success) {
                Logger.add('[AV_SYNC] Recovery failed, may escalate on next check');
            }
        }
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

// --- Experimental Recovery ---
/**
 * Experimental recovery strategies for testing new approaches.
 * @responsibility Serve as a playground for testing experimental recovery methods.
 * Can be enabled/disabled at runtime. Sits between Standard and Aggressive in the cascade.
 */
const ExperimentalRecovery = (() => {
    let enabled = false;  // Runtime toggle

    // Registry of experimental strategies to try
    const strategies = {
        pausePlay: async (video) => {
            Logger.add('Experimental: Pause/Play cycle');
            video.pause();
            await Fn.sleep(100);
            await video.play();
        },

        rateFluctuation: async (video) => {
            Logger.add('Experimental: Playback rate fluctuation');
            const oldRate = video.playbackRate;
            video.playbackRate = 0.5;
            await Fn.sleep(200);
            video.playbackRate = oldRate;
        }

        // Add more experimental strategies here as needed
    };

    return {
        // Main execute - tries all strategies sequentially
        execute: async (video) => {
            Logger.add('Executing experimental recovery');
            Metrics.increment('experimental_recoveries');

            // Try each strategy
            for (const [name, strategy] of Object.entries(strategies)) {
                try {
                    Logger.add(`Trying experimental strategy: ${name}`);
                    await strategy(video);
                    await Fn.sleep(100); // Let state settle

                    // Check if it helped (readyState 3 = HAVE_FUTURE_DATA)
                    if (video.readyState >= 3) {
                        Logger.add(`Experimental strategy '${name}' succeeded`);
                        return;
                    }
                } catch (e) {
                    Logger.add(`Experimental strategy '${name}' error`, { error: e.message });
                }
            }

            Logger.add('All experimental strategies attempted');
        },

        setEnabled: (state) => {
            enabled = state;
            Logger.add(`Experimental recovery ${state ? 'ENABLED' : 'DISABLED'}`);
        },

        isEnabled: () => enabled,

        hasStrategies: () => Object.keys(strategies).length > 0,

        // Test individual strategy (for manual testing)
        testStrategy: async (video, strategyName) => {
            if (strategies[strategyName]) {
                Logger.add(`Testing experimental strategy: ${strategyName}`);
                await strategies[strategyName](video);
            } else {
                Logger.add(`Unknown strategy: ${strategyName}`, {
                    available: Object.keys(strategies)
                });
            }
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
    const PLAY_CONFIRMATION_TIMEOUT_MS = 2000; // Increased from dynamic

    /**
     * Validates if the video is in a playable state before attempting play()
     * @param {HTMLVideoElement} video
     * @returns {{isValid: boolean, issues: string[]}}
     */
    const validatePlayable = (video) => {
        const issues = [];

        if (video.readyState < 3) {
            issues.push(`readyState too low: ${video.readyState}`);
        }
        if (video.error) {
            issues.push(`MediaError code: ${video.error.code}`);
        }
        if (!video.isConnected) {
            issues.push('Video element detached from DOM');
        }
        if (video.seeking) {
            issues.push('Already seeking');
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    };

    /**
     * Waits for the video to actually start playing.
     * @param {HTMLVideoElement} video
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    const waitForPlaying = (video, timeoutMs = 1000) => {
        return new Promise((resolve) => {
            if (!video.paused && video.readyState >= 3) {
                resolve(true);
                return;
            }

            let resolved = false;
            const cleanup = () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('pause', onPause);
            };

            const onPlaying = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            const onPause = () => {
                // If it pauses again immediately, we might fail this attempt,
                // but we let the timeout or the next check handle the final verdict.
            };

            video.addEventListener('playing', onPlaying);
            video.addEventListener('pause', onPause);

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(false);
                }
            }, timeoutMs);
        });
    };

    return {
        retry: async (video, context = 'unknown') => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const playStartTime = performance.now();

                // Pre-flight validation
                const validation = validatePlayable(video);
                if (!validation.isValid) {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} blocked by validation`, {
                        context,
                        issues: validation.issues,
                        videoState: {
                            readyState: video.readyState,
                            paused: video.paused,
                            isConnected: video.isConnected
                        }
                    });

                    if (attempt < MAX_RETRIES) {
                        await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                    }
                    continue;
                }

                // Intelligent micro-seek strategy
                if (attempt > 1) {
                    const shouldSeek = (
                        video.readyState >= 3 &&
                        !video.seeking &&
                        video.buffered.length > 0
                    );

                    if (shouldSeek) {
                        const bufferEnd = video.buffered.end(video.buffered.length - 1);
                        const gap = bufferEnd - video.currentTime;

                        if (gap > 1) {
                            const target = Math.min(video.currentTime + 0.5, bufferEnd - 0.1);
                            Logger.add(`[RECOVERY] Seeking to skip stuck point: ${target.toFixed(3)}`, {
                                context,
                                gap: gap.toFixed(3),
                                rationale: 'Player has buffer but stuck at current position'
                            });
                            video.currentTime = target;
                        } else {
                            Logger.add(`[RECOVERY] Skipping seek - insufficient buffer gap: ${gap.toFixed(3)}`, {
                                context
                            });
                        }
                    } else {
                        Logger.add('[RECOVERY] Skipping seek - conditions not met', {
                            context,
                            readyState: video.readyState,
                            seeking: video.seeking,
                            hasBuffer: video.buffered.length > 0
                        });
                    }
                }

                try {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} (${context})`, {
                        before: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime,
                            error: video.error ? video.error.code : null
                        },
                    });

                    await video.play();

                    // Wait for the 'playing' event to confirm success
                    const isPlaying = await waitForPlaying(video, PLAY_CONFIRMATION_TIMEOUT_MS);
                    await Fn.sleep(50); // Small buffer after event

                    if (isPlaying && !video.paused) {
                        Logger.add(`Play attempt ${attempt} SUCCESS`, {
                            context,
                            duration_ms: (performance.now() - playStartTime).toFixed(2)
                        });
                        return true;
                    }

                    Logger.add(`Play attempt ${attempt} FAILED: video still paused`, {
                        context,
                        duration_ms: (performance.now() - playStartTime).toFixed(2),
                        currentState: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime
                        }
                    });
                } catch (error) {
                    Logger.add(`Play attempt ${attempt} threw error`, {
                        context,
                        errorName: error.name,
                        errorMessage: error.message,
                        errorCode: error.code || null,
                        duration_ms: (performance.now() - playStartTime).toFixed(2),
                        videoState: {
                            readyState: video.readyState,
                            paused: video.paused,
                            networkState: video.networkState,
                            error: video.error ? video.error.code : null
                        }
                    });

                    // Categorize errors
                    if (error.name === 'NotAllowedError') {
                        Logger.add('[PLAYBACK] Browser blocked autoplay - cannot recover', { context });
                        return false; // Fatal, cannot recover
                    }
                    if (error.name === 'NotSupportedError') {
                        Logger.add('[PLAYBACK] Source not supported - cannot recover', { context });
                        return false; // Fatal
                    }
                    if (error.name === 'AbortError') {
                        Logger.add('[PLAYBACK] Play interrupted - possible DOM manipulation, retry allowed', { context });
                        // Continue to next attempt
                    }
                }

                if (attempt < MAX_RETRIES) {
                    await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                }
            }

            // Diagnostic summary
            Logger.add('All play attempts exhausted - DIAGNOSTIC SUMMARY', {
                context,
                attempts: MAX_RETRIES,
                finalState: {
                    paused: video.paused,
                    readyState: video.readyState,
                    networkState: video.networkState,
                    error: video.error ? video.error.code : null,
                    currentTime: video.currentTime,
                    bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
                },
                analysis: 'Player appears stuck - recommend aggressive recovery (stream refresh)'
            });

            return false;
        }
    };
})();

// --- Recovery Diagnostics ---
/**
 * Diagnoses playback blockers before attempting recovery.
 * @responsibility
 * 1. Identify WHY the player is stuck.
 * 2. Suggest targeted recovery strategies.
 * 3. Prevent wasted recovery attempts on unrecoverable states.
 */
const RecoveryDiagnostics = (() => {

    /**
     * Diagnoses the current video state to determine recovery feasibility.
     * @param {HTMLVideoElement} video
     * @returns {{canRecover: boolean, blockers: string[], suggestedStrategy: string, details: Object}}
     */
    const diagnose = (video) => {
        if (!video) {
            return {
                canRecover: false,
                blockers: ['NO_VIDEO_ELEMENT'],
                suggestedStrategy: 'fatal',
                details: { error: 'Video element is null or undefined' }
            };
        }

        // 1. DOM Attachment Check
        if (!video.isConnected) {
            Logger.add('[DIAGNOSTICS] Video element detached from DOM');
            return {
                canRecover: false,
                blockers: ['VIDEO_DETACHED'],
                suggestedStrategy: 'fatal',
                details: { error: 'Video element not connected to DOM' }
            };
        }

        // 2. Media Error Check
        if (video.error) {
            const errorCode = video.error.code;
            const isFatal = errorCode === video.error.MEDIA_ERR_SRC_NOT_SUPPORTED;

            Logger.add('[DIAGNOSTICS] Media error detected', {
                code: errorCode,
                message: video.error.message
            });

            return {
                canRecover: !isFatal,
                blockers: [`MEDIA_ERROR_${errorCode}`],
                suggestedStrategy: isFatal ? 'fatal' : 'aggressive',
                details: {
                    errorCode,
                    errorMessage: video.error.message,
                    isFatal
                }
            };
        }

        // 3. Network State Check
        if (video.networkState === video.NETWORK_NO_SOURCE) {
            Logger.add('[DIAGNOSTICS] No source available');
            return {
                canRecover: false,
                blockers: ['NO_SOURCE'],
                suggestedStrategy: 'fatal',
                details: { networkState: video.networkState }
            };
        }

        // 4. Seeking State Check
        if (video.seeking) {
            Logger.add('[DIAGNOSTICS] Video currently seeking');
            return {
                canRecover: true,
                blockers: ['ALREADY_SEEKING'],
                suggestedStrategy: 'wait',
                details: {
                    suggestion: 'Wait for seek to complete',
                    currentTime: video.currentTime
                }
            };
        }

        // 5. Ready State Check
        if (video.readyState < 3) {
            Logger.add('[DIAGNOSTICS] Insufficient data', {
                readyState: video.readyState
            });

            return {
                canRecover: true,
                blockers: ['INSUFFICIENT_DATA'],
                suggestedStrategy: 'wait',
                details: {
                    readyState: video.readyState,
                    suggestion: 'Wait for buffering to complete before recovery'
                }
            };
        }

        // 6. Buffer Health Check
        const bufferAnalysis = BufferAnalyzer.analyze(video);
        // Only report critical buffer if we have actual buffered content
        if (bufferAnalysis.bufferHealth === 'critical' && video.buffered.length > 0) {
            Logger.add('[DIAGNOSTICS] Critical buffer detected', bufferAnalysis);
            return {
                canRecover: true,
                blockers: ['CRITICAL_BUFFER'],
                suggestedStrategy: 'aggressive',
                details: {
                    bufferSize: bufferAnalysis.bufferSize,
                    bufferHealth: bufferAnalysis.bufferHealth,
                    suggestion: 'Standard recovery (seeking) will fail - need stream refresh'
                }
            };
        }

        // 7. Check signature stability (if available)
        if (Logic && Logic.Player && Logic.Player.isSessionUnstable) {
            const isUnstable = Logic.Player.isSessionUnstable();
            if (isUnstable) {
                Logger.add('[DIAGNOSTICS] Warning: Player signatures unstable');
            }
        }

        // All checks passed - standard recovery can proceed
        Logger.add('[DIAGNOSTICS] Video state appears recoverable', {
            readyState: video.readyState,
            paused: video.paused,
            bufferHealth: bufferAnalysis.bufferHealth
        });

        return {
            canRecover: true,
            blockers: [],
            suggestedStrategy: 'standard',
            details: {
                readyState: video.readyState,
                paused: video.paused,
                currentTime: video.currentTime,
                bufferHealth: bufferAnalysis.bufferHealth,
                bufferSize: bufferAnalysis.bufferSize
            }
        };
    };

    return {
        diagnose
    };
})();

// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * @responsibility Implement strategy pattern for recovery selection.
 */
const RecoveryStrategy = (() => {
    /**
     * Validates video element
     * @param {HTMLVideoElement} video - Video element to validate
     * @returns {boolean} True if valid
     */
    const validateVideo = (video) => {
        if (!video || !(video instanceof HTMLVideoElement)) {
            Logger.add('[RecoveryStrategy] Invalid video element', { video });
            return false;
        }
        return true;
    };

    return {
        select: (video, options = {}) => {
            // Manual overrides for testing only
            if (options.forceExperimental) {
                return ExperimentalRecovery;
            }
            if (options.forceAggressive) {
                return AggressiveRecovery;
            }
            if (options.forceStandard) {
                return StandardRecovery;
            }

            // Normal automatic flow - always start with Standard
            // Cascade to experimental/aggressive handled by ResilienceOrchestrator
            if (!validateVideo(video)) {
                Logger.add('[RecoveryStrategy] Defaulting to Standard - invalid video');
                return StandardRecovery;
            }

            let analysis;
            try {
                analysis = BufferAnalyzer.analyze(video);
            } catch (error) {
                Logger.add('[RecoveryStrategy] BufferAnalyzer failed, defaulting to Standard', { error: String(error) });
                return StandardRecovery;
            }
            Logger.add('Recovery strategy selection', {
                initialStrategy: 'Standard',
                bufferHealth: analysis.bufferHealth,
                bufferSize: analysis.bufferSize,
                forced: false
            });

            return StandardRecovery;
        },

        /**
         * Determines the next strategy to try if the current one failed or was insufficient.
         * @param {HTMLVideoElement} video - The video element
         * @param {Object} lastStrategy - The strategy that was just executed
         * @returns {Object|null} The next strategy to try, or null if no further escalation
         */
        getEscalation: (video, lastStrategy) => {
            if (!validateVideo(video)) {
                return null; // No escalation if video invalid
            }

            let analysis;
            try {
                analysis = BufferAnalyzer.analyze(video);
            } catch (error) {
                Logger.add('[RecoveryStrategy] BufferAnalyzer failed during escalation', { error: String(error) });
                return null; // No escalation on error
            }

            // Validate analysis object
            if (!analysis || typeof analysis.needsAggressive !== 'boolean') {
                Logger.add('[RecoveryStrategy] Invalid analysis object', { analysis });
                return null;
            }

            // If we just ran StandardRecovery and buffer is still critical
            if (lastStrategy === StandardRecovery) {
                if (analysis.needsAggressive) {
                    if (ExperimentalRecovery.isEnabled() && ExperimentalRecovery.hasStrategies()) {
                        Logger.add('[RECOVERY] Standard insufficient, escalating to Experimental');
                        return ExperimentalRecovery;
                    } else {
                        Logger.add('[RECOVERY] Standard insufficient, escalating to Aggressive');
                        return AggressiveRecovery;
                    }
                }
            }

            // If we just ran ExperimentalRecovery and buffer is still critical
            if (lastStrategy === ExperimentalRecovery) {
                if (analysis.needsAggressive) {
                    Logger.add('[RECOVERY] Experimental insufficient, escalating to Aggressive');
                    return AggressiveRecovery;
                }
            }

            return null;
        }
    };
})();

// --- Recovery Utilities ---
/**
 * Shared utilities for recovery modules.
 * @responsibility Provide common state capture and logging helpers.
 */
const RecoveryUtils = (() => {
    /**
     * Captures current video state snapshot.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Object} State snapshot
     */
    const captureVideoState = (video) => ({
        readyState: video.readyState,
        networkState: video.networkState,
        currentTime: video.currentTime,
        paused: video.paused,
        error: video.error ? video.error.code : null,
        bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
    });

    /**
     * Logs state transitions between two snapshots.
     * @param {Object} lastState - Previous state snapshot
     * @param {Object} currentState - Current state snapshot
     * @param {number} elapsed - Elapsed time in ms
     */
    const logStateTransitions = (lastState, currentState, elapsed) => {
        if (!lastState) return;

        if (lastState.readyState !== currentState.readyState) {
            Logger.add('Recovery: readyState transition', {
                from: lastState.readyState,
                to: currentState.readyState,
                elapsed_ms: elapsed.toFixed(0)
            });
        }

        if (lastState.networkState !== currentState.networkState) {
            Logger.add('Recovery: networkState transition', {
                from: lastState.networkState,
                to: currentState.networkState,
                elapsed_ms: elapsed.toFixed(0)
            });
        }

        if (!lastState.error && currentState.error) {
            Logger.add('Recovery: ERROR appeared during wait', {
                errorCode: currentState.error,
                elapsed_ms: elapsed.toFixed(0)
            });
        }
    };

    /**
     * Waits for video to reach ready state with forensic logging.
     * @param {HTMLVideoElement} video - The video element
     * @param {Object} options - Configuration options
     * @param {number} options.startTime - Recovery start timestamp
     * @param {number} options.timeoutMs - Max wait time
     * @param {number} options.checkIntervalMs - Check interval
     * @returns {Promise<void>}
     */
    const waitForStability = (video, options) => {
        const { startTime, timeoutMs, checkIntervalMs } = options;

        return new Promise(resolve => {
            const maxChecks = timeoutMs / checkIntervalMs;
            let checkCount = 0;
            let lastState = null;
            let lastCurrentTime = video.currentTime;

            const interval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                const currentState = captureVideoState(video);

                // Log state transitions
                logStateTransitions(lastState, currentState, elapsed);

                // Log progress every 1 second (10 checks at 100ms intervals)
                if (checkCount % 10 === 0 && checkCount > 0) {
                    const timeAdvanced = Math.abs(currentState.currentTime - lastCurrentTime) > 0.1;
                    Logger.add(`Recovery progress [${elapsed.toFixed(0)}ms]`, {
                        ...currentState,
                        playheadMoving: timeAdvanced
                    });
                }

                lastState = { ...currentState };
                lastCurrentTime = currentState.currentTime;
                checkCount++;

                // Success condition
                if (video.readyState >= 2) {
                    clearInterval(interval);
                    Logger.add('Player stabilized successfully', {
                        duration_ms: elapsed.toFixed(0),
                        finalReadyState: video.readyState,
                        totalChecks: checkCount
                    });
                    resolve();
                } else if (checkCount >= maxChecks) {
                    clearInterval(interval);
                    Logger.add('Player stabilization timeout', {
                        duration_ms: elapsed.toFixed(0),
                        finalReadyState: video.readyState,
                        finalNetworkState: video.networkState,
                        totalChecks: checkCount,
                        lastError: video.error ? video.error.code : null
                    });
                    resolve();
                }
            }, checkIntervalMs);
        });
    };

    return {
        captureVideoState,
        logStateTransitions,
        waitForStability
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
    let recoveryStartTime = 0;
    const RECOVERY_TIMEOUT_MS = 10000;

    /**
     * Captures a snapshot of current video element state.
     * @param {HTMLVideoElement} video - The video element to snapshot
     * @returns {Object} Snapshot containing readyState, networkState, currentTime, etc.
     */
    const captureVideoSnapshot = (video) => {
        return {
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
            paused: video.paused,
            error: video.error ? video.error.code : null,
            bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
        };
    };

    /**
     * Calculates the delta between pre and post recovery snapshots.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @returns {Object} Delta object showing what changed
     */
    const calculateRecoveryDelta = (preSnapshot, postSnapshot) => {
        return {
            readyStateChanged: preSnapshot.readyState !== postSnapshot.readyState,
            networkStateChanged: preSnapshot.networkState !== postSnapshot.networkState,
            currentTimeChanged: preSnapshot.currentTime !== postSnapshot.currentTime,
            pausedStateChanged: preSnapshot.paused !== postSnapshot.paused,
            errorCleared: preSnapshot.error && !postSnapshot.error,
            errorAppeared: !preSnapshot.error && postSnapshot.error,
            bufferIncreased: postSnapshot.bufferEnd > preSnapshot.bufferEnd
        };
    };

    /**
     * Validates if recovery actually improved the state.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @param {Object} delta - Calculated changes
     * @returns {{isValid: boolean, issues: string[], hasImprovement: boolean}}
     */
    const validateRecoverySuccess = (preSnapshot, postSnapshot, delta) => {
        const issues = [];

        // Check 1: Ready state should not decrease
        if (delta.readyStateChanged && postSnapshot.readyState < preSnapshot.readyState) {
            issues.push(`readyState decreased: ${preSnapshot.readyState} → ${postSnapshot.readyState}`);
        }

        // Check 2: Error should not appear
        if (delta.errorAppeared) {
            issues.push(`MediaError appeared: code ${postSnapshot.error}`);
        }

        // Check 3: Should have some positive change
        const hasImprovement = (
            delta.errorCleared ||  // Error was fixed
            (delta.readyStateChanged && postSnapshot.readyState > preSnapshot.readyState) ||
            (postSnapshot.bufferEnd > preSnapshot.bufferEnd + 0.1) // Buffer increased
        );

        if (!hasImprovement && !delta.pausedStateChanged) {
            issues.push('No measurable improvement detected');
        }

        return {
            isValid: issues.length === 0,
            issues,
            hasImprovement
        };
    };

    return {
        execute: async (container, payload = {}) => {
            if (isFixing) {
                // Check for stale lock
                if (Date.now() - recoveryStartTime > RECOVERY_TIMEOUT_MS) {
                    Logger.add('[RECOVERY] WARNING: Stale lock detected (timeout exceeded), forcing release');
                    isFixing = false;
                } else {
                    Logger.add('[RECOVERY] Resilience already in progress, skipping');
                    return;
                }
            }

            isFixing = true;
            recoveryStartTime = Date.now();
            let timeoutId = null;

            // Safety valve: Force unlock if execution takes too long
            timeoutId = setTimeout(() => {
                if (isFixing && Date.now() - recoveryStartTime >= RECOVERY_TIMEOUT_MS) {
                    Logger.add('[RECOVERY] WARNING: Execution timed out, forcing lock release');
                    isFixing = false;
                }
            }, RECOVERY_TIMEOUT_MS);

            const startTime = performance.now();

            try {
                Logger.add('[RECOVERY] Resilience execution started');
                Metrics.increment('resilience_executions');

                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) {
                    Logger.add('[RECOVERY] Resilience aborted: No video element found');
                    return;
                }

                // Fatal error check (existing)
                const { error } = video;
                if (error && error.code === CONFIG.codes.MEDIA_ERROR_SRC) {
                    Logger.add('[RECOVERY] Fatal error (code 4) - cannot recover, waiting for Twitch reload');
                    return;
                }

                // NEW: Use RecoveryDiagnostics
                const diagnosis = RecoveryDiagnostics.diagnose(video);
                if (!diagnosis.canRecover) {
                    Logger.add('[RECOVERY] Fatal blocker detected', diagnosis);
                    return;
                }

                // MODIFIED: Intelligent buffer validation
                const analysis = BufferAnalyzer.analyze(video);
                if (!payload.forceAggressive && analysis.bufferHealth === 'critical') {
                    // Critical buffer means standard recovery (seeking) will fail
                    const bufferSize = analysis.bufferSize || 0;

                    if (bufferSize < 2) {
                        Logger.add('[RECOVERY] Critical buffer - forcing aggressive recovery', {
                            bufferSize: bufferSize.toFixed(3),
                            bufferHealth: 'critical',
                            rationale: 'Standard recovery requires buffer > 2s, forcing stream refresh'
                        });
                        payload.forceAggressive = true; // Escalate to aggressive
                    } else {
                        Logger.add('[RECOVERY] Insufficient buffer but acceptable for recovery', {
                            bufferSize: bufferSize.toFixed(3)
                        });
                    }
                }

                // Capture pre-recovery state
                const preSnapshot = captureVideoSnapshot(video);
                Logger.add('[RECOVERY] Pre-recovery snapshot', preSnapshot);

                // NEW: Route A/V sync issues to specialized recovery
                if (payload.trigger === 'AV_SYNC' || (payload.reason && payload.reason.includes('A/V sync'))) {
                    const discrepancy = payload.details ? payload.details.discrepancy : 0;
                    Logger.add('[RECOVERY] Routing to specialized A/V sync recovery', { discrepancy });

                    await AVSyncRecovery.execute(video, discrepancy);

                    // Validate post-recovery state
                    const postSnapshot = captureVideoSnapshot(video);
                    const delta = calculateRecoveryDelta(preSnapshot, postSnapshot);
                    Logger.add('[RECOVERY] A/V sync recovery result', {
                        pre: preSnapshot,
                        post: postSnapshot,
                        changes: delta
                    });

                    isFixing = false;
                    return;
                }

                // Execute primary recovery strategy and handle escalation
                let currentStrategy = RecoveryStrategy.select(video, payload);

                while (currentStrategy) {
                    // Check if lock was stolen/timed out during execution
                    if (!isFixing) {
                        Logger.add('[RECOVERY] Lock lost during execution, aborting');
                        break;
                    }

                    await currentStrategy.execute(video);

                    // Check if we need to escalate to a more aggressive strategy
                    currentStrategy = RecoveryStrategy.getEscalation(video, currentStrategy);
                }

                // NEW: Validate recovery
                const postSnapshot = captureVideoSnapshot(video);
                const delta = calculateRecoveryDelta(preSnapshot, postSnapshot);
                const recoverySuccess = validateRecoverySuccess(preSnapshot, postSnapshot, delta);

                Logger.add('[RECOVERY] Post-recovery result', {
                    pre: preSnapshot,
                    post: postSnapshot,
                    changes: delta,
                    success: recoverySuccess
                });

                // NEW: Conditional escalation and play retry
                if (!recoverySuccess.isValid) {
                    Logger.add('[RECOVERY] Recovery validation detected issues', recoverySuccess.issues);

                    // NEW: Check if pre-state was already healthy
                    const wasAlreadyHealthy = preSnapshot.readyState === 4 &&
                        !preSnapshot.paused &&
                        !preSnapshot.error &&
                        analysis.bufferHealth !== 'critical';

                    if (wasAlreadyHealthy) {
                        Logger.add('[RECOVERY] Video was already healthy - recovery was unnecessary, canceling escalation');
                        // Do not escalate
                    } else if (!payload.forceAggressive) {
                        Logger.add('[RECOVERY] Escalating to aggressive recovery due to validation failure');
                        payload.forceAggressive = true;

                        // Re-run recovery with aggressive strategy
                        const aggressiveStrategy = RecoveryStrategy.select(video, payload);
                        if (aggressiveStrategy) {
                            await aggressiveStrategy.execute(video);

                            // Re-validate after aggressive recovery
                            const postSnapshot2 = captureVideoSnapshot(video);
                            const delta2 = calculateRecoveryDelta(postSnapshot, postSnapshot2);
                            const recoverySuccess2 = validateRecoverySuccess(postSnapshot, postSnapshot2, delta2);

                            Logger.add('[RECOVERY] Aggressive recovery result', {
                                success: recoverySuccess2
                            });
                        }
                    }
                } else {
                    Logger.add('[RECOVERY] Recovery validated successfully');
                }

                // Resume playback if needed AND recovery was successful
                if (video.paused) {
                    if (recoverySuccess.isValid) {
                        Logger.add('[RECOVERY] Recovery validated - attempting playback');
                        await PlayRetryHandler.retry(video, 'post-recovery');
                    } else {
                        Logger.add('[RECOVERY] Skipping play retry - recovery validation failed');
                    }
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, {
                    status: recoverySuccess.isValid ? 'SUCCESS' : 'FAILED'
                });
            } catch (e) {
                Logger.add('[RECOVERY] Resilience failed', { error: String(e) });
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
                isFixing = false;
                Logger.add('[RECOVERY] Resilience execution finished', {
                    total_duration_ms: performance.now() - startTime
                });
            }
        }
    };
})();

// --- Standard Recovery ---
/**
 * Simple seek-based recovery strategy.
 * @responsibility Seek to live edge without disrupting stream.
 */
const StandardRecovery = (() => {
    // const SEEK_OFFSET_S = 0.5; // Removed in favor of CONFIG.player.STANDARD_SEEK_BACK_S

    return {
        execute: (video) => {
            Logger.add('Executing standard recovery: seeking');

            if (!video || !video.buffered || video.buffered.length === 0) {
                Logger.add('Standard recovery aborted: no buffer');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const seekTarget = Math.max(0, bufferEnd - CONFIG.player.STANDARD_SEEK_BACK_S);
            video.currentTime = seekTarget;

            Logger.add('Standard recovery complete', {
                seekTo: seekTarget,
                bufferEnd,
                telemetry: {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    buffered: video.buffered.length > 0 ?
                        `[${video.buffered.start(0).toFixed(2)}, ${video.buffered.end(0).toFixed(2)}]` : 'none'
                }
            });

            // Post-Seek Health Check
            setTimeout(() => {
                Logger.add('Post-seek health check', {
                    currentTime: video.currentTime,
                    readyState: video.readyState,
                    networkState: video.networkState,
                    paused: video.paused,
                    bufferGap: video.buffered.length > 0 ?
                        (video.currentTime - video.buffered.end(video.buffered.length - 1)).toFixed(3) : 'unknown'
                });
            }, 1000);
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
            AdBlocker.init();

            // Wait for DOM if needed
            if (document.body) {
                DOMObserver.init();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    DOMObserver.init();
                }, { once: true });
            }

            // Expose debug triggers
            window.forceTwitchAdRecovery = () => {
                Logger.add('Manual recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, { source: 'MANUAL_TRIGGER' });
            };

            window.forceTwitchAggressiveRecovery = () => {
                Logger.add('Manual AGGRESSIVE recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'MANUAL_TRIGGER',
                    forceAggressive: true
                });
            };

            // Experimental recovery controls
            window.toggleExperimentalRecovery = (enable) => {
                ExperimentalRecovery.setEnabled(enable);
            };

            window.testExperimentalStrategy = (strategyName) => {
                const video = document.querySelector('video');
                if (video) {
                    ExperimentalRecovery.testStrategy(video, strategyName);
                } else {
                    console.log('No video element found');
                }
            };

            window.forceTwitchExperimentalRecovery = () => {
                Logger.add('Manual EXPERIMENTAL recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'MANUAL_TRIGGER',
                    forceExperimental: true
                });
            };

            window.testTwitchAdPatterns = () => {
                const tests = [
                    // Query parameter injection
                    { url: 'https://twitch.tv/ad_state/?x=1', expected: { isDelivery: true }, name: 'Delivery with query param' },
                    { url: 'https://twitch.tv/api?url=/ad_state/', expected: { isDelivery: false }, name: 'Query param injection (should NOT match)' },
                    { url: 'https://twitch.tv/video#/ad_state/', expected: { isDelivery: false }, name: 'Hash fragment (should NOT match)' },

                    // File extension matching  
                    { url: 'https://cdn.com/stream.m3u8?v=2', expected: { mockType: 'application/vnd.apple.mpegurl' }, name: 'M3U8 in pathname' },
                    { url: 'https://cdn.com/api?file=test.m3u8', expected: { mockType: 'application/json' }, name: 'M3U8 in query param (should NOT match)' },

                    // Availability check patterns
                    { url: 'https://twitch.tv/api?bp=preroll&channel=test', expected: { isAvailability: true }, name: 'Availability query param' },
                    { url: 'https://twitch.tv/bp=preroll', expected: { isAvailability: false }, name: 'Availability in pathname (should NOT match)' }
                ];

                Logger.add('========== URL PATTERN VALIDATION STARTED ==========');
                let passed = 0, failed = 0;

                tests.forEach((test, index) => {
                    const results = {
                        isDelivery: Logic.Network.isDelivery(test.url),
                        isAvailability: Logic.Network.isAvailabilityCheck(test.url),
                        mockType: Logic.Network.getMock(test.url).type
                    };

                    let testPassed = true;
                    const failures = [];

                    for (const [key, expected] of Object.entries(test.expected)) {
                        if (results[key] !== expected) {
                            testPassed = false;
                            failures.push(`${key}: expected ${expected}, got ${results[key]}`);
                        }
                    }

                    if (testPassed) {
                        passed++;
                        Logger.add(`[TEST ${index + 1}] ✓ PASSED: ${test.name}`, { url: test.url, results });
                    } else {
                        failed++;
                        Logger.add(`[TEST ${index + 1}] ✗ FAILED: ${test.name}`, { url: test.url, expected: test.expected, actual: results, failures });
                    }
                });

                const summary = `Tests Complete: ${passed} passed, ${failed} failed`;
                Logger.add(`========== ${summary} ==========`);
                console.log(summary);
                return { passed, failed, total: tests.length };
            };
        }
    };
})();

CoreOrchestrator.init();

})();
