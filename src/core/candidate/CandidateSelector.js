// --- CandidateSelector ---
/**
 * Scores and selects the best video candidate for healing.
 */
const CandidateSelector = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const logDebug = options.logDebug;
        const maxMonitors = options.maxMonitors;
        const minProgressMs = options.minProgressMs;
        const switchDelta = options.switchDelta;
        const isFallbackSource = options.isFallbackSource;

        let activeCandidateId = null;
        let lockChecker = null;
        let lastGoodCandidateId = null;
        const scorer = CandidateScorer.create({ minProgressMs, isFallbackSource });
        const switchPolicy = CandidateSwitchPolicy.create({
            switchDelta,
            minProgressMs,
            logDebug
        });
        const selectionLogger = CandidateSelectionLogger.create({ logDebug });
        const decisionEngine = CandidateDecision.create({ switchPolicy });
        const probation = CandidateProbation.create();

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const activateProbation = (reason) => probation.activate(reason);
        const isProbationActive = () => probation.isActive();

        const logOutcome = selectionLogger.logOutcome;

        const getActiveId = () => {
            if (!activeCandidateId && monitorsById.size > 0) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : monitorsById.keys().next().value;
                if (fallbackId) {
                    activeCandidateId = fallbackId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                        to: activeCandidateId,
                        reason: 'fallback'
                    });
                }
            }
            return activeCandidateId;
        };
        const setActiveId = (id) => {
            activeCandidateId = id;
        };

        const scoreVideo = (video, monitor, videoId) => scorer.score(video, monitor, videoId);
        const evaluateCandidates = (reason) => {
            const now = Date.now();
            if (lockChecker && lockChecker()) {
                logDebug(LogEvents.tagged('CANDIDATE', 'Failover lock active'), {
                    reason,
                    activeVideoId: activeCandidateId
                });
                return activeCandidateId ? { id: activeCandidateId } : null;
            }

            if (monitorsById.size === 0) {
                activeCandidateId = null;
                lastGoodCandidateId = null;
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
            } else if (lastGoodCandidateId && !monitorsById.has(lastGoodCandidateId)) {
                lastGoodCandidateId = null;
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
                }
            }

            if (preferred && preferred.id !== activeCandidateId) {
                const probationActive = isProbationActive();
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
                }

                logOutcome(decision);
            }

            return preferred;
        };

        const pruneMonitors = (excludeId, stopMonitoring) => {
            if (monitorsById.size <= maxMonitors) return;

            const protectedIds = new Set();
            if (activeCandidateId) protectedIds.add(activeCandidateId);
            if (lastGoodCandidateId) protectedIds.add(lastGoodCandidateId);

            let worst = null;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                if (protectedIds.has(videoId)) continue;
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                if (!worst || result.score < worst.score) {
                    worst = { id: videoId, entry, score: result.score };
                }
            }

            if (worst) {
                Logger.add(LogEvents.tagged('PRUNE', 'Stopped monitor due to cap'), {
                    videoId: worst.id,
                    score: worst.score,
                    maxMonitors
                });
                stopMonitoring(worst.entry.video);
            } else {
                logDebug(LogEvents.tagged('PRUNE_SKIP', 'All candidates protected'), {
                    protected: Array.from(protectedIds),
                    maxMonitors,
                    totalMonitors: monitorsById.size
                });
            }
        };

        const selectEmergencyCandidate = (reason, options = {}) => {
            const minReadyState = Number.isFinite(options.minReadyState)
                ? options.minReadyState
                : CONFIG.stall.NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE;
            const requireSrc = options.requireSrc !== undefined
                ? options.requireSrc
                : CONFIG.stall.NO_HEAL_POINT_EMERGENCY_REQUIRE_SRC;
            const allowDead = options.allowDead !== undefined
                ? options.allowDead
                : Boolean(CONFIG.stall.NO_HEAL_POINT_EMERGENCY_ALLOW_DEAD);
            const label = options.label || 'Emergency switch after no-heal point';
            let best = null;
            let bestScore = null;

            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === activeCandidateId) continue;
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                if (result.deadCandidate && !allowDead) continue;
                const readyState = result.vs.readyState;
                const hasSrc = Boolean(result.vs.currentSrc || result.vs.src);
                if (readyState < minReadyState) continue;
                if (requireSrc && !hasSrc) continue;
                if (bestScore === null || result.score > bestScore) {
                    bestScore = result.score;
                    best = {
                        id: videoId,
                        entry,
                        result,
                        readyState,
                        hasSrc
                    };
                }
            }

            if (!best) return null;

            const fromId = activeCandidateId;
            activeCandidateId = best.id;
            Logger.add(LogEvents.tagged('CANDIDATE', label), {
                from: fromId,
                to: best.id,
                reason,
                readyState: best.readyState,
                hasSrc: best.hasSrc,
                score: bestScore
            });
            return best;
        };

        return {
            evaluateCandidates,
            pruneMonitors,
            scoreVideo,
            getActiveId,
            setActiveId,
            setLockChecker,
            activateProbation,
            isProbationActive,
            selectEmergencyCandidate
        };
    };

    return { create };
})();
