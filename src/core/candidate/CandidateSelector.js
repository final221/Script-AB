// --- CandidateSelector ---
// @module CandidateSelector
// @depends CandidateForceSwitch, ActiveCandidateState
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

        let lockChecker = null;
        const streamIdentity = StreamIdentityModel.create({
            monitorsById,
            isFallbackSource
        });

        const scorer = CandidateScorer.create({
            minProgressMs,
            isFallbackSource,
            scoreIdentity: (videoId, videoState, monitorState) => (
                streamIdentity.scoreCandidate(videoId, videoState, monitorState, getActiveIdRaw())
            )
        });
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

        const scoreVideo = (video, monitor, videoId) => scorer.score(video, monitor, videoId);
        const formerStreamTracker = FormerStreamTracker.create({
            monitorsById,
            scoreVideo
        });
        const activeState = ActiveCandidateState.create({
            onSwitch: ({ fromId, toId, reason }) => {
                formerStreamTracker.trackSwitch({
                    fromId,
                    toId,
                    reason
                });
            },
            onActive: (id, reason) => {
                formerStreamTracker.onActive(id);
                streamIdentity.observeActive(id, reason);
            }
        });
        const activateCandidate = (id, reason = 'manual') => activeState.activateCandidate(id, reason);
        const clearActive = (reason = 'manual_clear') => activeState.clearActive(reason);
        const getActiveIdRaw = () => activeState.getActiveId();
        const getLastGoodId = () => activeState.getLastGoodId();
        const setLastGoodId = (id) => activeState.setLastGoodId(id);
        const observeFormerStreams = (reason) => {
            formerStreamTracker.observe({
                reason,
                activeId: activeState.getActiveId()
            });
        };
        const logContinuitySnapshot = (decision, current, preferred) => {
            if (!decision || !current || !preferred || decision.fromId === decision.toId) {
                return;
            }
            Logger.add(LogEvents.tagged('CANDIDATE', 'Stream continuity snapshot'), {
                reason: decision.reason,
                action: decision.action,
                fastSwitchKind: decision.fastSwitchKind || null,
                continuity: streamIdentity.buildContinuitySnapshot({
                    activeId: decision.fromId,
                    preferredId: decision.toId,
                    current,
                    preferred
                })
            });
        };

        const getActiveId = () => activeState.getActiveId();
        const forceSwitchController = CandidateForceSwitch.create({
            monitorsById,
            isFallbackSource,
            getActiveId,
            activateCandidate,
            observeFormerStreams,
            logDebug
        });
        const getActiveContext = forceSwitchController.getActiveContext;
        const forceSwitch = forceSwitchController.forceSwitch;

        const selectionEngine = CandidateSelectionEngine.create({
            monitorsById,
            scoreVideo,
            decisionEngine,
            probation,
            getActiveId: getActiveIdRaw,
            getLastGoodId,
            getLockChecker: () => lockChecker
        });

        const evaluateCandidates = (reason) => {
            streamIdentity.observeActive(getActiveIdRaw(), `pre_eval:${reason}`);
            const result = selectionEngine.evaluateCandidates(reason);
            activeState.noteEvaluation(reason, result?.now || Date.now());
            if (!result) {
                observeFormerStreams(reason);
                return null;
            }

            if (result.status === 'locked') {
                logDebug(LogEvents.tagged('CANDIDATE', 'Failover lock active'), {
                    reason,
                    activeVideoId: result.activeCandidateId
                });
                observeFormerStreams(reason);
                return result.activeCandidateId ? { id: result.activeCandidateId } : null;
            }

            if (result.status === 'empty') {
                clearActive('empty');
                setLastGoodId(null);
                observeFormerStreams(reason);
                return null;
            }

            if (result.nextLastGoodId !== getLastGoodId()) {
                setLastGoodId(result.nextLastGoodId);
            }

            if (result.activation) {
                Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                    to: result.activation.toId,
                    reason: result.activation.reason,
                    streamOriginVideoId: streamIdentity.getSnapshot().originVideoId,
                    scores: result.scores
                });
                activateCandidate(result.activation.toId, `activation:${result.activation.reason}`);
            }

            const decision = result.decision;
            if (decision) {
                logContinuitySnapshot(decision, result.current, decision.preferred || result.preferred);
                if (decision.action === 'fast_switch') {
                    const fromId = decision.fromId;
                    const reclaimedOrigin = decision.fastSwitchKind === 'reclaim_origin';
                    Logger.add(LogEvents.tagged('CANDIDATE', reclaimedOrigin
                        ? 'Recovered origin stream reclaimed'
                        : 'Fast switch from healing dead-end'), {
                        from: fromId,
                        to: decision.toId,
                        reason: decision.reason,
                        fastSwitchKind: decision.fastSwitchKind || 'healing_dead_end',
                        activeState: decision.activeState,
                        noHealPointCount: decision.activeNoHealPoints,
                        stalledForMs: decision.activeStalledForMs,
                        preferredScore: decision.preferred.score,
                        preferredIdentityScore: decision.preferred.identityScore || 0,
                        preferredProgressStreakMs: decision.preferred.progressStreakMs,
                        preferredTrusted: decision.preferred.trusted,
                        streamOriginVideoId: streamIdentity.getSnapshot().originVideoId
                    });
                    activateCandidate(decision.toId, `fast_switch:${decision.reason}`);
                    logOutcome(decision);
                    observeFormerStreams(reason);
                    return result.preferred;
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
                        bestIdentityScore: decision.preferred.identityScore || 0,
                        bestProgressStreakMs: decision.preferred.progressStreakMs,
                        bestProgressEligible: decision.preferred.progressEligible,
                        probationActive: decision.probationActive,
                        streamOriginVideoId: streamIdentity.getSnapshot().originVideoId,
                        scores: result.scores
                    });
                    activateCandidate(decision.toId, `switch:${decision.reason}`);
                }

                logOutcome(decision);
            }

            observeFormerStreams(reason);
            return result.preferred;
        };

        const pruner = CandidatePruner.create({
            monitorsById,
            logDebug,
            maxMonitors,
            scoreVideo,
            getActiveId: getActiveIdRaw,
            getLastGoodId
        });

        const emergencyPicker = EmergencyCandidatePicker.create({
            monitorsById,
            scoreVideo,
            getActiveId: getActiveIdRaw,
            activateCandidate,
            isFallbackSource,
            logDebug
        });

        return {
            evaluateCandidates,
            pruneMonitors: pruner.pruneMonitors,
            scoreVideo,
            getActiveId,
            activateCandidate,
            clearActive,
            setActiveId: activateCandidate,
            setLockChecker,
            activateProbation,
            isProbationActive,
            selectEmergencyCandidate: emergencyPicker.selectEmergencyCandidate,
            getActiveContext,
            forceSwitch,
            shouldRunIntervalEvaluation: activeState.shouldRunIntervalEvaluation
        };
    };

    return { create };
})();
