// --- CandidateTrust ---
/**
 * Determines whether a candidate is trusted for switching/failover.
 */
const CandidateTrust = (() => {
    const BAD_REASONS = ['fallback_src', 'ended', 'not_in_dom', 'reset', 'error_state', 'error'];

    const isTrusted = (result) => {
        if (!result || !result.progressEligible) return false;
        const reasons = Array.isArray(result.reasons) ? result.reasons : [];
        return !BAD_REASONS.some(reason => reasons.includes(reason));
    };

    return { isTrusted };
})();
