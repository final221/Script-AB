// @module ActiveCandidateState
// @depends CandidateSelectionLogger
/**
 * Centralizes active/last-good candidate state and evaluation timing.
 */
const ActiveCandidateState = (() => {
    const create = (options = {}) => {
        const onSwitch = options.onSwitch || (() => {});
        const onActive = options.onActive || (() => {});

        const state = {
            activeCandidateId: null,
            lastGoodCandidateId: null,
            lastEvaluationAt: 0,
            lastEvaluationReason: null
        };

        const activateCandidate = (id, reason = 'manual') => {
            const previousActiveId = state.activeCandidateId;
            if (previousActiveId && previousActiveId !== id) {
                onSwitch({
                    fromId: previousActiveId,
                    toId: id,
                    reason
                });
            }
            state.activeCandidateId = id;
            onActive(id, reason);
            return id;
        };

        const clearActive = (reason = 'manual_clear') => activateCandidate(null, reason);
        const getActiveId = () => state.activeCandidateId;
        const getLastGoodId = () => state.lastGoodCandidateId;
        const setLastGoodId = (id) => {
            state.lastGoodCandidateId = id;
            return id;
        };
        const noteEvaluation = (reason, now = Date.now()) => {
            state.lastEvaluationAt = now;
            state.lastEvaluationReason = reason || null;
        };
        const shouldRunIntervalEvaluation = (minGapMs, now = Date.now()) => {
            if (!state.lastEvaluationAt) return true;
            if (!Number.isFinite(minGapMs) || minGapMs <= 0) return true;
            return (now - state.lastEvaluationAt) >= minGapMs;
        };

        return {
            activateCandidate,
            clearActive,
            getActiveId,
            getLastGoodId,
            setLastGoodId,
            noteEvaluation,
            shouldRunIntervalEvaluation
        };
    };

    return { create };
})();
