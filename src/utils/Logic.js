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
