// --- CandidateSelectionEngine ---
/**
 * Evaluation flow for selecting the active candidate.
 */
const CandidateSelectionEngine = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const logDebug = options.logDebug;
        const scoreVideo = options.scoreVideo;
        const decisionEngine = options.decisionEngine;
        const probation = options.probation;
        const logOutcome = options.logOutcome;
        const getActiveId = options.getActiveId;
        const setActiveId = options.setActiveId;
        const getLastGoodId = options.getLastGoodId;
        const setLastGoodId = options.setLastGoodId;
        const getLockChecker = options.getLockChecker;

        const evaluateCandidates = (reason) => {
            const now = Date.now();
            const lockChecker = getLockChecker ? getLockChecker() : null;
            let activeCandidateId = getActiveId();
            let lastGoodCandidateId = getLastGoodId();

            if (lockChecker && lockChecker()) {
                logDebug(LogEvents.tagged('CANDIDATE', 'Failover lock active'), {
                    reason,
                    activeVideoId: activeCandidateId
                });
                return activeCandidateId ? { id: activeCandidateId } : null;
            }

            if (monitorsById.size === 0) {
                setActiveId(null);
                setLastGoodId(null);
                return null;
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
                setLastGoodId(lastGoodCandidateId);
            } else if (lastGoodCandidateId && !monitorsById.has(lastGoodCandidateId)) {
                lastGoodCandidateId = null;
                setLastGoodId(null);
            }

            const preferred = bestTrustedNonDead || bestNonDead || bestTrusted || best;

            if (!activeCandidateId || !monitorsById.has(activeCandidateId)) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : preferred?.id;
                if (fallbackId) {
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                        to: fallbackId,
                        reason: 'no_active',
                        scores
                    });
                    activeCandidateId = fallbackId;
                    setActiveId(activeCandidateId);
                }
            }

            if (preferred && preferred.id !== activeCandidateId) {
                const probationActive = probation.isActive();
                const decision = decisionEngine.decide({
                    now,
                    current,
                    preferred,
                    activeCandidateId,
                    probationActive,
                    scores,
                    reason
                });

                if (decision.action === 'fast_switch') {
                    const fromId = decision.fromId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Fast switch from healing dead-end'), {
                        from: fromId,
                        to: decision.toId,
                        reason: decision.reason,
                        activeState: decision.activeState,
                        noHealPointCount: decision.activeNoHealPoints,
                        stalledForMs: decision.activeStalledForMs,
                        preferredScore: decision.preferred.score,
                        preferredProgressStreakMs: decision.preferred.progressStreakMs,
                        preferredTrusted: decision.preferred.trusted
                    });
                    activeCandidateId = decision.toId;
                    setActiveId(activeCandidateId);
                    logOutcome(decision);
                    return preferred;
                }

                if (decision.action === 'switch') {
                    const fromId = decision.fromId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video switched'), {
                        from: fromId,
                        to: decision.toId,
                        reason: decision.reason,
                        delta: decision.policyDecision.delta,
                        currentScore: decision.policyDecision.currentScore,
                        bestScore: decision.preferred.score,
                        bestProgressStreakMs: decision.preferred.progressStreakMs,
                        bestProgressEligible: decision.preferred.progressEligible,
                        probationActive,
                        scores
                    });
                    activeCandidateId = decision.toId;
                    setActiveId(activeCandidateId);
                }

                logOutcome(decision);
            }

            return preferred;
        };

        return { evaluateCandidates };
    };

    return { create };
})();
