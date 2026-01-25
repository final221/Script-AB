// --- LogDebug ---
/**
 * Shared debug logger helper to avoid repeating CONFIG.debug checks.
 */
const LogDebug = (() => {
    const resolveEnabled = (enabled) => {
        if (typeof enabled === 'function') return Boolean(enabled());
        if (enabled === undefined) return Boolean(CONFIG.debug);
        return Boolean(enabled);
    };

    const normalizeDetail = (detail) => (
        detail && typeof detail === 'object' ? { ...detail } : null
    );

    const create = (options = {}) => {
        const baseDetail = normalizeDetail(options.baseDetail);
        const enabled = options.enabled;

        return (message, detail) => {
            if (!resolveEnabled(enabled)) return;
            if (baseDetail && detail && typeof detail === 'object') {
                Logger.add(message, { ...baseDetail, ...detail });
                return;
            }
            if (baseDetail) {
                Logger.add(message, baseDetail);
                return;
            }
            Logger.add(message, detail);
        };
    };

    return { create };
})();
