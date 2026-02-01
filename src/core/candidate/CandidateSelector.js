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

        const getActiveContext = () => {
            const activeId = state.activeCandidateId;
            const entry = activeId ? monitorsById.get(activeId) : null;
            const monitorState = entry ? entry.monitor.state : null;
            const activeState = monitorState ? monitorState.state : null;
            const activeIsStalled = !entry || [
                MonitorStates.STALLED,
                MonitorStates.RESET,
                MonitorStates.ERROR
            ].includes(activeState);
            const activeIsSevere = activeIsStalled
                && (activeState === MonitorStates.RESET
                    || activeState === MonitorStates.ERROR
                    || monitorState?.bufferStarved);
            return {
                activeId,
                entry,
                monitorState,
                activeState,
                activeIsStalled,
                activeIsSevere
            };
        };

        const isFallbackCandidate = (candidate) => {
            if (!candidate) return false;
            if (candidate.reasons?.includes('fallback_src')) return true;
            const src = candidate.vs?.currentSrc || candidate.vs?.src || '';
            return Boolean(src) && isFallbackSource(src);
        };

        const forceSwitch = (best, options = {}) => {
            const context = getActiveContext();
            const reason = options.reason || 'forced';
            const shouldConsider = best && best.id && context.activeId && best.id !== context.activeId;
            if (!shouldConsider) {
                return {
                    ...context,
                    switched: false,
                    suppressed: false
                };
            }

            if (isFallbackCandidate(best)) {
                Logger.add(LogEvents.tagged('CANDIDATE', options.suppressionLabel || 'Forced switch suppressed (fallback source)'), {
                    from: context.activeId,
                    to: best.id,
                    reason,
                    suppression: 'fallback_src',
                    currentSrc: best.vs?.currentSrc || '',
                    bestScore: best.score
                });
                logDebug(LogEvents.tagged('CANDIDATE', options.suppressionLabel || 'Forced switch suppressed'), {
                    from: context.activeId,
                    to: best.id,
                    reason,
                    suppression: 'fallback_src',
                    currentSrc: best.vs?.currentSrc || '',
                    bestScore: best.score
                });
                return {
                    ...context,
                    switched: false,
                    suppressed: true
                };
            }

            const requireProgressEligible = options.requireProgressEligible !== false;
            const requireSevere = options.requireSevere !== false;
            const progressEligible = !requireProgressEligible || best.progressEligible;
            const activeOk = requireSevere ? context.activeIsSevere : context.activeIsStalled;
            const allowSwitch = progressEligible && activeOk;

            if (allowSwitch) {
                const fromId = context.activeId;
                setActiveId(best.id);
                Logger.add(LogEvents.tagged('CANDIDATE', options.label || 'Forced switch'), {
                    from: fromId,
                    to: best.id,
                    reason,
                    bestScore: best.score,
                    progressStreakMs: best.progressStreakMs,
                    progressEligible: best.progressEligible,
                    activeState: context.activeState,
                    bufferStarved: context.monitorState?.bufferStarved || false
                });
                return {
                    ...context,
                    activeId: best.id,
                    switched: true,
                    suppressed: false
                };
            }

            logDebug(LogEvents.tagged('CANDIDATE', options.suppressionLabel || 'Forced switch suppressed'), {
                from: context.activeId,
                to: best.id,
                reason,
                progressEligible: best.progressEligible,
                activeState: context.activeState,
                bufferStarved: context.monitorState?.bufferStarved || false,
                activeIsSevere: context.activeIsSevere
            });

            return {
                ...context,
                switched: false,
                suppressed: true
            };
        };

        const getActiveId = () => state.activeCandidateId;

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
            const result = selectionEngine.evaluateCandidates(reason);
            if (!result) return null;

            if (result.status === 'locked') {
                logDebug(LogEvents.tagged('CANDIDATE', 'Failover lock active'), {
                    reason,
                    activeVideoId: result.activeCandidateId
                });
                return result.activeCandidateId ? { id: result.activeCandidateId } : null;
            }

            if (result.status === 'empty') {
                setActiveId(null);
                setLastGoodId(null);
                return null;
            }

            if (result.nextLastGoodId !== getLastGoodId()) {
                setLastGoodId(result.nextLastGoodId);
            }

            if (result.activation) {
                Logger.add(LogEvents.tagged('CANDIDATE', 'Active video set'), {
                    to: result.activation.toId,
                    reason: result.activation.reason,
                    scores: result.scores
                });
                setActiveId(result.activation.toId);
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
                        preferredProgressStreakMs: decision.preferred.progressStreakMs,
                        preferredTrusted: decision.preferred.trusted
                    });
                    setActiveId(decision.toId);
                    logOutcome(decision);
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
                        bestProgressStreakMs: decision.preferred.progressStreakMs,
                        bestProgressEligible: decision.preferred.progressEligible,
                        probationActive: decision.probationActive,
                        scores: result.scores
                    });
                    setActiveId(decision.toId);
                }

                logOutcome(decision);
            }

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
