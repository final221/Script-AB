// --- CandidateSelector ---
// @module CandidateSelector
// @depends CandidateForceSwitch
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

        const state = {
            activeCandidateId: null,
            lastGoodCandidateId: null
        };
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
        const getActiveIdRaw = () => state.activeCandidateId;
        const formerStreamTracker = FormerStreamTracker.create({
            monitorsById,
            scoreVideo
        });
        const setActiveId = (id, reason = 'manual') => {
            const previousActiveId = state.activeCandidateId;
            if (previousActiveId && previousActiveId !== id) {
                formerStreamTracker.trackSwitch({
                    fromId: previousActiveId,
                    toId: id,
                    reason
                });
            }
            state.activeCandidateId = id;
            formerStreamTracker.onActive(id);
            streamIdentity.observeActive(id, reason);
        };
        const getLastGoodId = () => state.lastGoodCandidateId;
        const setLastGoodId = (id) => {
            state.lastGoodCandidateId = id;
        };
        const observeFormerStreams = (reason) => {
            formerStreamTracker.observe({
                reason,
                activeId: state.activeCandidateId
            });
        };

        const getActiveId = () => state.activeCandidateId;
        const forceSwitchController = CandidateForceSwitch.create({
            monitorsById,
            isFallbackSource,
            getActiveId,
            setActiveId,
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
                setActiveId(null, 'empty');
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
                setActiveId(result.activation.toId, `activation:${result.activation.reason}`);
            }

            const decision = result.decision;
            if (decision) {
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
                        preferredIdentityScore: decision.preferred.identityScore || 0,
                        preferredProgressStreakMs: decision.preferred.progressStreakMs,
                        preferredTrusted: decision.preferred.trusted,
                        streamOriginVideoId: streamIdentity.getSnapshot().originVideoId
                    });
                    setActiveId(decision.toId, `fast_switch:${decision.reason}`);
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
                    setActiveId(decision.toId, `switch:${decision.reason}`);
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
            setActiveId,
            isFallbackSource,
            logDebug
        });

        return {
            evaluateCandidates,
            pruneMonitors: pruner.pruneMonitors,
            scoreVideo,
            getActiveId,
            setActiveId,
            setLockChecker,
            activateProbation,
            isProbationActive,
            selectEmergencyCandidate: emergencyPicker.selectEmergencyCandidate,
            getActiveContext,
            forceSwitch
        };
    };

    return { create };
})();
