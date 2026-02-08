// --- CandidateForceSwitch ---
// @module CandidateForceSwitch
/**
 * Encapsulates active-candidate context inspection and forced switch logic.
 */
const CandidateForceSwitch = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const isFallbackSource = options.isFallbackSource;
        const getActiveId = options.getActiveId;
        const setActiveId = options.setActiveId;
        const observeFormerStreams = options.observeFormerStreams;
        const logDebug = options.logDebug || (() => {});

        const getActiveContext = () => {
            const activeId = getActiveId();
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
                return { ...context, switched: false, suppressed: false };
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
                return { ...context, switched: false, suppressed: true };
            }

            const requireProgressEligible = options.requireProgressEligible !== false;
            const requireSevere = options.requireSevere !== false;
            const progressEligible = !requireProgressEligible || best.progressEligible;
            const activeOk = requireSevere ? context.activeIsSevere : context.activeIsStalled;
            const allowSwitch = progressEligible && activeOk;
            if (!allowSwitch) {
                logDebug(LogEvents.tagged('CANDIDATE', options.suppressionLabel || 'Forced switch suppressed'), {
                    from: context.activeId,
                    to: best.id,
                    reason,
                    progressEligible: best.progressEligible,
                    activeState: context.activeState,
                    bufferStarved: context.monitorState?.bufferStarved || false,
                    activeIsSevere: context.activeIsSevere
                });
                return { ...context, switched: false, suppressed: true };
            }

            const fromId = context.activeId;
            setActiveId(best.id, `force_switch:${reason}`);
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
            observeFormerStreams(`force_switch:${reason}`);
            return { ...context, activeId: best.id, switched: true, suppressed: false };
        };

        return {
            getActiveContext,
            forceSwitch
        };
    };

    return { create };
})();
