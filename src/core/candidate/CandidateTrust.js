// --- CandidateTrust ---
/**
 * Determines whether a candidate is trusted for switching/failover.
 */
const CandidateTrust = (() => {
    const BAD_REASONS = ['fallback_src', 'ended', 'not_in_dom', 'reset', 'reset_pending', 'error_state', 'error'];

    const getTrustInfo = (result) => {
        if (!result || !result.progressEligible) {
            return { trusted: false, reason: 'progress_ineligible' };
        }
        const reasons = Array.isArray(result.reasons) ? result.reasons : [];
        if (BAD_REASONS.some(reason => reasons.includes(reason))) {
            return { trusted: false, reason: 'bad_reason' };
        }
        const progressAgoMs = Number.isFinite(result.progressAgoMs)
            ? result.progressAgoMs
            : null;
        if (progressAgoMs === null || progressAgoMs > CONFIG.monitoring.TRUST_STALE_MS) {
            return { trusted: false, reason: 'progress_stale' };
        }
        return { trusted: true, reason: 'trusted' };
    };

    const isTrusted = (result) => getTrustInfo(result).trusted;

    return {
        isTrusted,
        getTrustInfo
    };
})();
