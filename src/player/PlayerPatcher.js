// --- Player Patcher ---
/**
 * Experimental: Hooks into Twitch player internals to intercept ad methods.
 * DISABLED by default - enable via CONFIG.experimental.ENABLE_PLAYER_PATCHING
 * 
 * @warning This is intrusive and could be detected by Twitch.
 */
const PlayerPatcher = (() => {
    let enabled = false;
    let patchApplied = false;
    let patchedMethods = [];
    let interceptedCalls = 0;

    // Fuzzy patterns for ad-related method names
    const AD_METHOD_PATTERNS = [
        /^(play|show|display|start|trigger|fire|load|queue)ad/i,
        /ad(play|start|begin|load|queue|show)$/i,
        /^on(ad|commercial|preroll|midroll)/i,
        /(ad|commercial|sponsor)(handler|manager|controller)/i,
        /^(preroll|midroll|postroll)/i,
        /commercial(break|start|end)/i
    ];

    /**
     * Check if a method name looks like an ad handler
     * @param {string} name - Method name to check
     * @returns {boolean} True if matches ad patterns
     */
    const looksLikeAdMethod = (name) => {
        if (!name || typeof name !== 'string') return false;
        return AD_METHOD_PATTERNS.some(pattern => pattern.test(name));
    };

    /**
     * Recursively scan object for ad-like methods
     * @param {Object} obj - Object to scan
     * @param {number} depth - Current recursion depth
     * @param {string} path - Current path for logging
     * @returns {Array} Found ad methods
     */
    const findAdMethods = (obj, depth = 0, path = '') => {
        if (!obj || typeof obj !== 'object' || depth > 3) return [];

        const found = [];

        try {
            const keys = Object.keys(obj);

            for (const key of keys) {
                const fullPath = path ? `${path}.${key}` : key;

                try {
                    const value = obj[key];

                    if (typeof value === 'function' && looksLikeAdMethod(key)) {
                        found.push({ name: key, path: fullPath, obj, fn: value });
                        Logger.add('[PlayerPatcher] Found potential ad method', {
                            method: key,
                            path: fullPath,
                            depth
                        });
                    }

                    // Recurse into nested objects (but not functions/DOM/etc)
                    if (typeof value === 'object' &&
                        value !== null &&
                        !(value instanceof HTMLElement) &&
                        !(value instanceof Window)) {
                        found.push(...findAdMethods(value, depth + 1, fullPath));
                    }
                } catch (e) {
                    // Skip inaccessible properties
                }
            }
        } catch (e) {
            Logger.add('[PlayerPatcher] Scan error', { path, error: e.message });
        }

        return found;
    };

    /**
     * Apply patches to intercept ad methods
     * @param {Object} playerContext - Player context from PlayerContext.get()
     */
    const applyPatch = (playerContext) => {
        if (!enabled) {
            Logger.add('[PlayerPatcher] Not enabled, skipping patch');
            return;
        }

        if (patchApplied) {
            Logger.add('[PlayerPatcher] Patch already applied');
            return;
        }

        if (!playerContext) {
            Logger.add('[PlayerPatcher] No player context provided');
            return;
        }

        Logger.add('[PlayerPatcher] Starting scan for ad methods...', {
            contextKeys: Object.keys(playerContext).length
        });

        try {
            const player = playerContext.player || playerContext;
            const adMethods = findAdMethods(player);

            Logger.add('[PlayerPatcher] Scan complete', {
                methodsFound: adMethods.length,
                methods: adMethods.map(m => m.path)
            });

            if (adMethods.length === 0) {
                Logger.add('[PlayerPatcher] No ad methods found to patch');
                return;
            }

            for (const { name, path, obj, fn } of adMethods) {
                try {
                    const original = fn.bind(obj);

                    obj[name] = function (...args) {
                        interceptedCalls++;
                        Logger.add('[PlayerPatcher] INTERCEPTED ad method call', {
                            method: name,
                            path,
                            callNumber: interceptedCalls,
                            argCount: args.length
                        });

                        // Return a resolved promise to satisfy any await
                        return Promise.resolve({
                            skipped: true,
                            method: name,
                            interceptedBy: 'PlayerPatcher'
                        });
                    };

                    patchedMethods.push({ name, path });
                    Logger.add('[PlayerPatcher] Patched method successfully', {
                        method: name,
                        path
                    });
                } catch (e) {
                    Logger.add('[PlayerPatcher] Failed to patch method', {
                        method: name,
                        path,
                        error: e.message
                    });
                }
            }

            // Intercept addEventListener for ad events
            if (typeof player.addEventListener === 'function') {
                const originalAddEventListener = player.addEventListener.bind(player);

                player.addEventListener = function (event, handler, options) {
                    if (/ad|commercial|preroll|midroll|sponsor/i.test(event)) {
                        Logger.add('[PlayerPatcher] Blocked ad event listener', {
                            event,
                            blocked: true
                        });
                        return; // Don't add ad-related listeners
                    }
                    return originalAddEventListener(event, handler, options);
                };

                Logger.add('[PlayerPatcher] Patched addEventListener');
                patchedMethods.push({ name: 'addEventListener', path: 'player.addEventListener' });
            }

            patchApplied = true;
            Logger.add('[PlayerPatcher] Patch complete', {
                totalPatched: patchedMethods.length,
                methods: patchedMethods.map(m => m.name)
            });

        } catch (e) {
            Logger.add('[PlayerPatcher] Patch failed with error', {
                error: e.name,
                message: e.message,
                stack: e.stack?.substring(0, 200)
            });
        }
    };

    /**
     * Enable the patcher
     */
    const enable = () => {
        enabled = true;
        Logger.add('[PlayerPatcher] Enabled');
    };

    /**
     * Disable the patcher
     */
    const disable = () => {
        enabled = false;
        Logger.add('[PlayerPatcher] Disabled');
    };

    /**
     * Reset patch state (for re-patching after player remount)
     */
    const reset = () => {
        patchApplied = false;
        patchedMethods = [];
        interceptedCalls = 0;
        Logger.add('[PlayerPatcher] Reset');
    };

    return {
        enable,
        disable,
        isEnabled: () => enabled,
        apply: applyPatch,
        reset,
        getStats: () => ({
            enabled,
            patchApplied,
            patchedMethodCount: patchedMethods.length,
            patchedMethods: patchedMethods.map(m => m.name),
            interceptedCalls
        })
    };
})();
