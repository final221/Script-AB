// --- CandidateProbation ---
/**
 * Handles probation window tracking for candidate switching.
 */
const CandidateProbation = (() => {
    const create = () => {
        let probationUntil = 0;
        let probationReason = null;

        const activate = (reason) => {
            const windowMs = CONFIG.monitoring.PROBATION_WINDOW_MS;
            probationUntil = Date.now() + windowMs;
            probationReason = reason || 'unknown';
            Logger.add(LogEvents.tagged('PROBATION', 'Window started'), {
                reason: probationReason,
                windowMs
            });
        };

        const isActive = () => {
            if (!probationUntil) return false;
            if (Date.now() <= probationUntil) {
                return true;
            }
            Logger.add(LogEvents.tagged('PROBATION', 'Window ended'), {
                reason: probationReason
            });
            probationUntil = 0;
            probationReason = null;
            return false;
        };

        return {
            activate,
            isActive
        };
    };

    return { create };
})();
