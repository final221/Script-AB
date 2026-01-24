// --- RecoveryPolicyFactory ---
/**
 * Factory that wires recovery policy submodules into a single policy interface.
 */
const RecoveryPolicyFactory = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const candidateSelector = options.candidateSelector;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;

        const backoffManager = BackoffManager.create({ logDebug });

        const probationPolicy = ProbationPolicy.create({
            candidateSelector,
            onRescan
        });
        const noHealPointPolicy = NoHealPointPolicy.create({
            backoffManager,
            candidateSelector,
            monitorsById,
            getVideoId,
            onRescan,
            onPersistentFailure,
            logDebug,
            probationPolicy
        });
        const playErrorPolicy = PlayErrorPolicy.create({
            candidateSelector,
            monitorsById,
            getVideoId,
            onRescan,
            logDebug,
            probationPolicy
        });
        const stallSkipPolicy = StallSkipPolicy.create({
            backoffManager,
            logDebug
        });

        return {
            resetBackoff: backoffManager.resetBackoff,
            resetPlayError: playErrorPolicy.resetPlayError,
            handleNoHealPoint: noHealPointPolicy.handleNoHealPoint,
            handlePlayFailure: playErrorPolicy.handlePlayFailure,
            shouldSkipStall: stallSkipPolicy.shouldSkipStall,
            policies: {
                probation: probationPolicy,
                noHealPoint: noHealPointPolicy,
                playError: playErrorPolicy,
                stallSkip: stallSkipPolicy
            }
        };
    };

    return { create };
})();
