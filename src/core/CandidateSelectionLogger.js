// --- CandidateSelectionLogger ---
/**
 * Logging helpers for candidate selection decisions/suppressions.
 */
const CandidateSelectionLogger = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        let lastDecisionLogTime = 0;
        let suppressionSummary = {
            lastLogTime: Date.now(),
            counts: {},
            lastSample: null
        };

        const shouldLogDecision = (reason) => (
            reason !== 'interval'
            || (Date.now() - lastDecisionLogTime) >= CONFIG.logging.ACTIVE_LOG_MS
        );

        const logDecision = (detail) => {
            if (!detail || !shouldLogDecision(detail.reason)) return;
            lastDecisionLogTime = Date.now();
            Logger.add(LogEvents.tagged('CANDIDATE_DECISION', 'Selection summary'), detail);
        };

        const logSuppression = (detail) => {
            if (!detail) return;
            if (detail.reason !== 'interval') {
                logDebug(LogEvents.tagged('CANDIDATE', 'Switch suppressed'), detail);
                return;
            }
            const cause = detail.cause || 'unknown';
            suppressionSummary.counts[cause] = (suppressionSummary.counts[cause] || 0) + 1;
            suppressionSummary.lastSample = {
                from: detail.from,
                to: detail.to,
                cause,
                reason: detail.reason,
                activeState: detail.activeState,
                probationActive: detail.probationActive
            };

            const now = Date.now();
            const windowMs = now - suppressionSummary.lastLogTime;
            if (windowMs < CONFIG.logging.SUPPRESSION_LOG_MS) {
                return;
            }
            const total = Object.values(suppressionSummary.counts)
                .reduce((sum, count) => sum + count, 0);
            if (total > 0) {
                Logger.add(LogEvents.tagged('SUPPRESSION', 'Switch suppressed summary'), {
                    windowMs,
                    total,
                    byCause: suppressionSummary.counts,
                    lastSample: suppressionSummary.lastSample
                });
            }
            suppressionSummary = {
                lastLogTime: now,
                counts: {},
                lastSample: null
            };
        };

        return {
            logDecision,
            logSuppression
        };
    };

    return { create };
})();
