// --- CandidateSelectionEngine ---
/**
 * Evaluation flow for selecting the active candidate.
 */
const CandidateSelectionEngine = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const scoreVideo = options.scoreVideo;
        const decisionEngine = options.decisionEngine;
        const probation = options.probation;
        const getActiveId = options.getActiveId;
        const getLastGoodId = options.getLastGoodId;
        const getLockChecker = options.getLockChecker;

        const evaluateCandidates = (reason) => {
            const now = Date.now();
            const lockChecker = getLockChecker ? getLockChecker() : null;
            let activeCandidateId = getActiveId();
            let lastGoodCandidateId = getLastGoodId();

            if (lockChecker && lockChecker()) {
                return {
                    status: 'locked',
                    reason,
                    activeCandidateId,
                    lastGoodCandidateId
                };
            }

            if (monitorsById.size === 0) {
                return {
                    status: 'empty',
                    reason,
                    activeCandidateId,
                    lastGoodCandidateId,
                    nextActiveId: null,
                    nextLastGoodId: null,
                    preferred: null,
                    scores: []
                };
            }

            const evaluation = CandidateEvaluation.evaluate({
                monitorsById,
                activeCandidateId,
                scoreVideo
            });
            const scores = evaluation.scores;
            const current = evaluation.current;
            const best = evaluation.best;
            const bestNonDead = evaluation.bestNonDead;
            const bestTrusted = evaluation.bestTrusted;
            const bestTrustedNonDead = evaluation.bestTrustedNonDead;

            if (bestTrusted) {
                lastGoodCandidateId = bestTrusted.id;
            } else if (lastGoodCandidateId && !monitorsById.has(lastGoodCandidateId)) {
                lastGoodCandidateId = null;
            }

            const preferred = bestTrustedNonDead || bestNonDead || bestTrusted || best;
            let activation = null;

            if (!activeCandidateId || !monitorsById.has(activeCandidateId)) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : preferred?.id;
                if (fallbackId) {
                    activeCandidateId = fallbackId;
                    activation = {
                        action: 'set_active',
                        toId: activeCandidateId,
                        reason: 'no_active'
                    };
                }
            }

            let decision = null;
            if (preferred && preferred.id !== activeCandidateId) {
                decision = decisionEngine.decide({
                    now,
                    current,
                    preferred,
                    activeCandidateId,
                    probationActive: probation.isActive(),
                    scores,
                    reason
                });
            }

            return {
                status: 'evaluated',
                reason,
                now,
                scores,
                current,
                preferred,
                decision,
                activation,
                activeCandidateId,
                lastGoodCandidateId,
                nextActiveId: activeCandidateId,
                nextLastGoodId: lastGoodCandidateId
            };
        };

        return { evaluateCandidates };
    };

    return { create };
})();
