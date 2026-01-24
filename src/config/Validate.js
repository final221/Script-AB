// --- ConfigValidator ---
/**
 * Lightweight config validation and sanity checks.
 */
const ConfigValidator = (() => {
    const validate = (config) => {
        const warnings = [];
        const warn = (message, detail = {}) => warnings.push({ message, detail });

        if (!config?.stall) return warnings;

        if (config.stall.STALL_CONFIRM_MS <= 0) {
            warn('STALL_CONFIRM_MS must be positive', { value: config.stall.STALL_CONFIRM_MS });
        }
        if (config.stall.SELF_RECOVER_MAX_MS
            && config.stall.SELF_RECOVER_GRACE_MS > config.stall.SELF_RECOVER_MAX_MS) {
            warn('SELF_RECOVER_GRACE_MS exceeds SELF_RECOVER_MAX_MS', {
                graceMs: config.stall.SELF_RECOVER_GRACE_MS,
                maxMs: config.stall.SELF_RECOVER_MAX_MS
            });
        }
        if (config.stall.NO_HEAL_POINT_BACKOFF_BASE_MS > config.stall.NO_HEAL_POINT_BACKOFF_MAX_MS) {
            warn('NO_HEAL_POINT_BACKOFF_BASE_MS exceeds NO_HEAL_POINT_BACKOFF_MAX_MS', {
                baseMs: config.stall.NO_HEAL_POINT_BACKOFF_BASE_MS,
                maxMs: config.stall.NO_HEAL_POINT_BACKOFF_MAX_MS
            });
        }
        if (config.stall.PLAY_ERROR_BACKOFF_BASE_MS > config.stall.PLAY_ERROR_BACKOFF_MAX_MS) {
            warn('PLAY_ERROR_BACKOFF_BASE_MS exceeds PLAY_ERROR_BACKOFF_MAX_MS', {
                baseMs: config.stall.PLAY_ERROR_BACKOFF_BASE_MS,
                maxMs: config.stall.PLAY_ERROR_BACKOFF_MAX_MS
            });
        }
        if ((config.stall.PLAY_ABORT_BACKOFF_BASE_MS || 0) > (config.stall.PLAY_ABORT_BACKOFF_MAX_MS || 0)) {
            warn('PLAY_ABORT_BACKOFF_BASE_MS exceeds PLAY_ABORT_BACKOFF_MAX_MS', {
                baseMs: config.stall.PLAY_ABORT_BACKOFF_BASE_MS,
                maxMs: config.stall.PLAY_ABORT_BACKOFF_MAX_MS
            });
        }
        if (config.stall.HEAL_TIMEOUT_S * 1000 < config.stall.STALL_CONFIRM_MS) {
            warn('HEAL_TIMEOUT_S is shorter than STALL_CONFIRM_MS', {
                healTimeoutMs: config.stall.HEAL_TIMEOUT_S * 1000,
                stallConfirmMs: config.stall.STALL_CONFIRM_MS
            });
        }

        return warnings;
    };

    return { validate };
})();
