// --- RecoveryPolicy ---
/**
 * Centralized recovery/backoff policy logic.
 */
const RecoveryPolicy = (() => {
    const create = (options = {}) => RecoveryPolicyFactory.create(options);

    return { create };
})();
