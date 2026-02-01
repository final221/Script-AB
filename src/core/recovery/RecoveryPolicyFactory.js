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
        const decisionApplier = RecoveryDecisionApplier.create({
            backoffManager,
            candidateSelector,
            logDebug,
            onRescan,
            onPersistentFailure,
            probationPolicy
        });
        const noHealPointPolicy = NoHealPointPolicy.create({
            candidateSelector,
            monitorsById,
            getVideoId,
            probationPolicy
        });
        const playErrorPolicy = PlayErrorPolicy.create({
            monitorsById,
            getVideoId,
            logDebug,
            probationPolicy
        });
        const stallSkipPolicy = StallSkipPolicy.create({ backoffManager });

        return {
            resetBackoff: backoffManager.resetBackoff,
            resetPlayError: playErrorPolicy.resetPlayError,
            handleNoHealPoint: (context, reason) => (
                decisionApplier.applyDecision(noHealPointPolicy.decide(context, reason))
            ),
            handlePlayFailure: (context, detail) => (
                decisionApplier.applyDecision(playErrorPolicy.decide(context, detail))
            ),
            shouldSkipStall: (context) => (
                decisionApplier.applyDecision(stallSkipPolicy.decide(context))
            ),
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
