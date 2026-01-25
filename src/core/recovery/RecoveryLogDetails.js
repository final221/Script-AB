// --- RecoveryLogDetails ---
/**
 * Shared log detail builders for recovery policies.
 */
const RecoveryLogDetails = (() => {
    const playBackoffReset = (detail = {}) => ({
        reason: detail.reason,
        previousPlayErrors: detail.previousPlayErrors,
        previousNextPlayAllowedMs: detail.previousNextPlayAllowedMs,
        previousHealPointRepeats: detail.previousHealPointRepeats
    });

    const playBackoff = (detail = {}) => ({
        videoId: detail.videoId,
        reason: detail.reason,
        error: detail.error,
        errorName: detail.errorName,
        playErrorCount: detail.playErrorCount,
        backoffMs: detail.backoffMs,
        abortBackoff: detail.abortBackoff,
        nextHealAllowedInMs: detail.nextHealAllowedInMs,
        healRange: detail.healRange || null,
        healPointRepeatCount: detail.healPointRepeatCount || 0
    });

    const refresh = (detail = {}) => ({
        videoId: detail.videoId,
        reason: detail.reason,
        noHealPointCount: detail.noHealPointCount
    });

    return {
        playBackoffReset,
        playBackoff,
        refresh
    };
})();
