// --- ProbationPolicy ---
/**
 * Shared probation/rescan logic for recovery decisions.
 */
const ProbationPolicy = (() => {
    const create = (options = {}) => {
        const candidateSelector = options.candidateSelector;
        const onRescan = options.onRescan || (() => {});

        let lastProbationRescanAt = 0;

        const canRescan = (now) => (
            now - lastProbationRescanAt >= CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS
        );

        const triggerRescan = (reason, detail = {}) => {
            const now = Date.now();
            if (!canRescan(now)) {
                return false;
            }
            lastProbationRescanAt = now;
            if (candidateSelector) {
                candidateSelector.activateProbation(reason);
            }
            onRescan(reason, detail);
            return true;
        };

        const maybeTriggerProbation = (videoId, monitorState, trigger, count, threshold) => {
            if (!monitorState) return false;
            if (count < threshold) {
                return false;
            }
            const reason = trigger || 'probation';
            return triggerRescan(reason, {
                videoId,
                count,
                trigger: reason
            });
        };

        return {
            maybeTriggerProbation,
            triggerRescan,
            canRescan: () => canRescan(Date.now())
        };
    };

    return { create };
})();
