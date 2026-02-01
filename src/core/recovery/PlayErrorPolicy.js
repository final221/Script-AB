// --- PlayErrorPolicy ---
/**
 * Handles play error backoff and repeat heal-point behavior.
 */
const PlayErrorPolicy = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug || (() => {});
        const probationPolicy = options.probationPolicy;

        const resetPlayError = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.playErrorCount > 0 || monitorState.nextPlayHealAllowedTime > 0) {
                logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Reset'), RecoveryLogDetails.playBackoffReset({
                    reason,
                    previousPlayErrors: monitorState.playErrorCount,
                    previousNextPlayAllowedMs: monitorState.nextPlayHealAllowedTime
                        ? Math.max(monitorState.nextPlayHealAllowedTime - Date.now(), 0)
                        : 0,
                    previousHealPointRepeats: monitorState.healPointRepeatCount
                }));
            }
            PlaybackStateStore.resetPlayErrorState(monitorState);
        };

        const decide = (context, detail = {}) => {
            const video = context.video;
            const monitorState = context.monitorState;
            if (!monitorState) {
                return {
                    shouldFailover: false,
                    probationEligible: false,
                    repeatStuck: false,
                    repeatCount: 0
                };
            }
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');
            const now = Date.now();
            const lastErrorTime = monitorState.lastPlayErrorTime || 0;
            const baseCount = (lastErrorTime > 0 && (now - lastErrorTime) > CONFIG.stall.PLAY_ERROR_DECAY_MS)
                ? 0
                : (monitorState.playErrorCount || 0);
            const count = baseCount + 1;
            const isAbortError = detail?.errorName === 'AbortError'
                || (typeof detail?.error === 'string' && detail.error.toLowerCase().includes('aborted'));
            const base = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_BASE_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS;
            const max = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_MAX_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            const repeatCount = detail.healPointRepeatCount || 0;
            const repeatStuck = repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT;

            const shouldFailover = monitorsById && monitorsById.size > 1
                && (count >= CONFIG.stall.FAILOVER_AFTER_PLAY_ERRORS || repeatStuck);

            return {
                videoId,
                monitorState,
                reason: detail.reason || 'play_error',
                error: detail.error,
                errorName: detail.errorName,
                healRange: detail.healRange || null,
                healPointRepeatCount: repeatCount,
                now,
                count,
                backoffMs,
                isAbortError,
                shouldFailover,
                probationEligible: Boolean(probationPolicy?.maybeTriggerProbation),
                repeatStuck
            };
        };

        return {
            resetPlayError,
            decide
        };
    };

    return { create };
})();
