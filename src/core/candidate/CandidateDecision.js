// --- CandidateDecision ---
/**
 * Builds candidate switch decisions from scoring + policy inputs.
 */
const CandidateDecision = (() => {
    const create = (options = {}) => {
        const switchPolicy = options.switchPolicy;

        const decide = (context = {}) => (
            switchPolicy?.decide
                ? switchPolicy.decide(context)
                : {
                    action: 'none',
                    reason: context.reason,
                    fromId: context.activeCandidateId || null,
                    toId: context.preferred?.id || null,
                    preferred: context.preferred || null,
                    scores: context.scores || []
                }
        );

        return { decide };
    };

    return { create };
})();
