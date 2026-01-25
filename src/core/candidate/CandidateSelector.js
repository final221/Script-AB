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
        const probation = CandidateProbation.create();

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const activateProbation = (reason) => probation.activate(reason);
        const isProbationActive = () => probation.isActive();

        const logDecision = selectionLogger.logDecision;
        const logSuppression = selectionLogger.logSuppression;

        const buildSwitchDecision = ({ now, current, preferred, activeCandidateId, probationActive, scores, reason }) => {
            if (!preferred || preferred.id === activeCandidateId) {
                return { action: 'none' };
            }

            const activeState = current ? current.state : null;
            const activeMonitorState = current ? current.monitorState : null;
            const activeNoHealPoints = activeMonitorState?.noHealPointCount || 0;
            const activeStalledForMs = activeMonitorState?.lastProgressTime
                ? (now - activeMonitorState.lastProgressTime)
                : null;
            const activeHealing = activeState === 'HEALING';
            const activeIsStalled = !current || ['STALLED', 'RESET', 'ERROR', 'ENDED'].includes(activeState);
            const probationProgressOk = preferred.progressStreakMs >= CONFIG.monitoring.PROBATION_MIN_PROGRESS_MS;
            const probationReady = probationActive
                && probationProgressOk
                && (preferred.vs.readyState >= CONFIG.monitoring.PROBATION_READY_STATE
                    || preferred.vs.currentSrc);

            const fastSwitchAllowed = activeHealing
                && preferred.trusted
                && preferred.progressEligible
                && preferred.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS
                && (activeNoHealPoints >= CONFIG.stall.FAST_SWITCH_AFTER_NO_HEAL_POINTS
                    || (activeStalledForMs !== null && activeStalledForMs >= CONFIG.stall.FAST_SWITCH_AFTER_STALL_MS));

            const baseDecision = {
                activeState,
                activeIsStalled,
                activeNoHealPoints,
                activeStalledForMs,
                probationActive,
                probationReady,
                preferred,
                currentTrusted: current ? current.trusted : false
            };

            if (fastSwitchAllowed) {
                return {
                    action: 'fast_switch',
                    ...baseDecision
                };
            }

            if (!preferred.progressEligible && !probationReady) {
                return {
                    action: 'stay',
                    suppression: 'preferred_not_progress_eligible',
                    ...baseDecision
                };
            }

            if (!activeIsStalled) {
                return {
                    action: 'stay',
                    suppression: 'active_not_stalled',
                    ...baseDecision
                };
            }

            if (baseDecision.currentTrusted && !preferred.trusted) {
                return {
                    action: 'stay',
                    suppression: 'trusted_active_blocks_untrusted',
                    ...baseDecision
                };
            }

            if (!preferred.trusted && !probationActive) {
                return {
                    action: 'stay',
                    suppression: 'untrusted_outside_probation',
                    ...baseDecision
                };
            }

            const preferredForPolicy = probationReady
                ? { ...preferred, progressEligible: true }
                : preferred;
            const policyDecision = switchPolicy.shouldSwitch(current, preferredForPolicy, scores, reason);

            if (policyDecision.allow) {
                return {
                    action: 'switch',
                    policyDecision,
                    preferredForPolicy,
                    ...baseDecision
                };
            }

            return {
                action: 'stay',
                suppression: policyDecision.suppression || 'score_delta',
                policyDecision,
                preferredForPolicy,
                ...baseDecision
            };
        };

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
                const decision = buildSwitchDecision({
                    now,
                    current,
                    preferred,
                    activeCandidateId,
                    probationActive,
                    scores,
                    reason
                });

                if (decision.action === 'fast_switch') {
                    const fromId = activeCandidateId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Fast switch from healing dead-end'), {
                        from: fromId,
                        to: preferred.id,
                        reason,
                        activeState: decision.activeState,
                        noHealPointCount: decision.activeNoHealPoints,
                        stalledForMs: decision.activeStalledForMs,
                        preferredScore: preferred.score,
                        preferredProgressStreakMs: preferred.progressStreakMs,
                        preferredTrusted: preferred.trusted
                    });
                    activeCandidateId = preferred.id;
                    logDecision({
                        reason,
                        action: 'fast_switch',
                        from: fromId,
                        to: activeCandidateId,
                        activeState: decision.activeState,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (decision.action === 'stay' && decision.suppression === 'preferred_not_progress_eligible') {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: decision.suppression,
                        activeState: decision.activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression,
                        activeId: activeCandidateId,
                        activeState: decision.activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive,
                        probationReady: decision.probationReady
                    });
                    return preferred;
                }

                if (decision.action === 'stay' && decision.suppression === 'active_not_stalled') {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: decision.suppression,
                        activeState: decision.activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression,
                        activeId: activeCandidateId,
                        activeState: decision.activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (decision.action === 'stay' && decision.suppression === 'trusted_active_blocks_untrusted') {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: decision.suppression,
                        activeState: decision.activeState,
                        probationActive,
                        currentTrusted: decision.currentTrusted,
                        preferredTrusted: preferred.trusted,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression,
                        activeId: activeCandidateId,
                        activeState: decision.activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (decision.action === 'stay' && decision.suppression === 'untrusted_outside_probation') {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: decision.suppression,
                        activeState: decision.activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression,
                        activeId: activeCandidateId,
                        activeState: decision.activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (decision.action === 'switch') {
                    const fromId = activeCandidateId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video switched'), {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        delta: decision.policyDecision.delta,
                        currentScore: decision.policyDecision.currentScore,
                        bestScore: preferred.score,
                        bestProgressStreakMs: preferred.progressStreakMs,
                        bestProgressEligible: preferred.progressEligible,
                        probationActive,
                        scores
                    });
                    activeCandidateId = preferred.id;
                    logDecision({
                        reason,
                        action: 'switch',
                        from: fromId,
                        to: activeCandidateId,
                        activeState: decision.activeState,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                } else if (decision.action === 'stay') {
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression,
                        activeId: activeCandidateId,
                        activeState: decision.activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                }
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
