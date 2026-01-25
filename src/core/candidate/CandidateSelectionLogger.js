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

        const buildDecisionDetail = (decision) => {
            if (!decision) return null;
            const preferred = decision.preferred || decision.preferredForPolicy;
            const detail = {
                reason: decision.reason,
                action: decision.action,
                activeState: decision.activeState,
                preferredScore: preferred?.score,
                preferredProgressEligible: preferred?.progressEligible,
                preferredTrusted: preferred?.trusted,
                probationActive: decision.probationActive
            };

            if (decision.action === 'stay') {
                detail.suppression = decision.suppression;
                detail.activeId = decision.fromId;
                detail.preferredId = decision.toId;
                if (decision.probationReady) {
                    detail.probationReady = decision.probationReady;
                }
            }

            if (decision.action === 'switch' || decision.action === 'fast_switch') {
                detail.from = decision.fromId;
                detail.to = decision.toId;
            }

            return detail;
        };

        const buildSuppressionDetail = (decision) => {
            if (!decision || decision.action !== 'stay' || !decision.suppression) return null;
            const detail = {
                from: decision.fromId,
                to: decision.toId,
                reason: decision.reason,
                cause: decision.suppression,
                activeState: decision.activeState,
                probationActive: decision.probationActive,
                scores: decision.scores
            };

            if (decision.suppression === 'trusted_active_blocks_untrusted') {
                detail.currentTrusted = decision.currentTrusted;
                detail.preferredTrusted = decision.preferred?.trusted;
            }

            return detail;
        };

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
            logSuppression,
            logOutcome: (decision) => {
                if (!decision || decision.action === 'none') return;
                const suppression = buildSuppressionDetail(decision);
                if (suppression) {
                    logSuppression(suppression);
                }
                const detail = buildDecisionDetail(decision);
                if (detail) {
                    logDecision(detail);
                }
            }
        };
    };

    return { create };
})();
