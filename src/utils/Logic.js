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
            // Statistics tracking (internal)
            _signatureStats: {
                k0: { matches: 0, keys: [] },
                k1: { matches: 0, keys: [] },
                k2: { matches: 0, keys: [] }
            },

            signatures: [
                {
                    id: 'k0',
                    check: (o, k) => {
                        try {
                            const result = typeof o[k] === 'function' && o[k](true) === null;
                            if (result) {
                                Logic.Player._signatureStats.k0.matches++;
                                if (!Logic.Player._signatureStats.k0.keys.includes(k)) {
                                    Logic.Player._signatureStats.k0.keys.push(k);
                                    // ✅ This gets exported with exportTwitchAdLogs()
                                    Logger.add('[Logic] Signature k0 matched NEW key', { key: k, totalMatches: Logic.Player._signatureStats.k0.matches });
                                }
                            }
                            return result;
                        } catch (e) {
                            return false;
                        }
                    }
                }, // Toggle/Mute
                {
                    id: 'k1',
                    check: (o, k) => {
                        try {
                            const result = typeof o[k] === 'function' && o[k]() === null;
                            if (result) {
                                Logic.Player._signatureStats.k1.matches++;
                                if (!Logic.Player._signatureStats.k1.keys.includes(k)) {
                                    Logic.Player._signatureStats.k1.keys.push(k);
                                    // ✅ This gets exported with exportTwitchAdLogs()
                                    Logger.add('[Logic] Signature k1 matched NEW key', { key: k, totalMatches: Logic.Player._signatureStats.k1.matches });
                                }
                            }
                            return result;
                        } catch (e) {
                            return false;
                        }
                    }
                }, // Pause
                {
                    id: 'k2',
                    check: (o, k) => {
                        try {
                            const result = typeof o[k] === 'function' && o[k]() === null;
                            if (result) {
                                Logic.Player._signatureStats.k2.matches++;
                                if (!Logic.Player._signatureStats.k2.keys.includes(k)) {
                                    Logic.Player._signatureStats.k2.keys.push(k);
                                    // ✅ This gets exported with exportTwitchAdLogs()
                                    Logger.add('[Logic] Signature k2 matched NEW key', { key: k, totalMatches: Logic.Player._signatureStats.k2.matches });
                                }
                            }
                            return result;
                        } catch (e) {
                            return false;
                        }
                    }
                }  // Other
            ],
            validate: (obj, key, sig) => Fn.tryCatch(() => typeof obj[key] === 'function' && sig.check(obj, key), () => false)(),

            // Export stats summary (for debugging)
            getSignatureStats: () => Logic.Player._signatureStats
        }
    };
})();
