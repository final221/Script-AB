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

        const state = {
            activeCandidateId: null,
            lastGoodCandidateId: null
        };
        let lockChecker = null;

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

        const scoreVideo = (video, monitor, videoId) => scorer.score(video, monitor, videoId);
        const getActiveIdRaw = () => state.activeCandidateId;
        const setActiveId = (id) => {
            state.activeCandidateId = id;
        };
        const getLastGoodId = () => state.lastGoodCandidateId;
        const setLastGoodId = (id) => {
            state.lastGoodCandidateId = id;
        };

        const getActiveId = () => {
            if (!state.activeCandidateId && monitorsById.size > 0) {
                const fallbackId = (state.lastGoodCandidateId && monitorsById.has(state.lastGoodCandidateId))
                    ? state.lastGoodCandidateId
                    : monitorsById.keys().next().value;
                if (fallbackId) {
                    state.activeCandidateId = fallbackId;
                    Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                        to: state.activeCandidateId,
                        reason: 'fallback'
                    });
                }
            }
            return state.activeCandidateId;
        };

        const selectionEngine = CandidateSelectionEngine.create({
            monitorsById,
            logDebug,
            scoreVideo,
            decisionEngine,
            probation,
            logOutcome,
            getActiveId: getActiveIdRaw,
            setActiveId,
            getLastGoodId,
            setLastGoodId,
            getLockChecker: () => lockChecker
        });

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
            setActiveId
        });

        return {
            evaluateCandidates: selectionEngine.evaluateCandidates,
            pruneMonitors: pruner.pruneMonitors,
            scoreVideo,
            getActiveId,
            setActiveId,
            setLockChecker,
            activateProbation,
            isProbationActive,
            selectEmergencyCandidate: emergencyPicker.selectEmergencyCandidate
        };
    };

    return { create };
})();
