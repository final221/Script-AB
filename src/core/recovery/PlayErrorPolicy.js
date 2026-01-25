// --- PlayErrorPolicy ---
/**
 * Handles play error backoff and repeat heal-point behavior.
 */
const PlayErrorPolicy = (() => {
    const create = (options = {}) => {
        const candidateSelector = options.candidateSelector;
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;
        const onRescan = options.onRescan || (() => {});
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
            monitorState.playErrorCount = 0;
            monitorState.nextPlayHealAllowedTime = 0;
            monitorState.lastPlayErrorTime = 0;
            monitorState.lastPlayBackoffLogTime = 0;
            monitorState.lastHealPointKey = null;
            monitorState.healPointRepeatCount = 0;
        };

        const handlePlayFailure = (context, detail = {}) => {
            const video = context.video;
            const monitorState = context.monitorState;
            if (!monitorState) return { shouldFailover: false, probationTriggered: false, repeatStuck: false };
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');
            const now = Date.now();
            const lastErrorTime = monitorState.lastPlayErrorTime || 0;
            if (lastErrorTime > 0 && (now - lastErrorTime) > CONFIG.stall.PLAY_ERROR_DECAY_MS) {
                monitorState.playErrorCount = 0;
            }

            const count = (monitorState.playErrorCount || 0) + 1;
            const isAbortError = detail?.errorName === 'AbortError'
                || (typeof detail?.error === 'string' && detail.error.toLowerCase().includes('aborted'));
            const base = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_BASE_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS;
            const max = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_MAX_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.playErrorCount = count;
            monitorState.lastPlayErrorTime = now;
            monitorState.nextPlayHealAllowedTime = now + backoffMs;

            Logger.add(LogEvents.tagged('PLAY_BACKOFF', 'Play failed'), RecoveryLogDetails.playBackoff({
                videoId,
                reason: detail.reason,
                error: detail.error,
                errorName: detail.errorName,
                playErrorCount: count,
                backoffMs,
                abortBackoff: isAbortError,
                nextHealAllowedInMs: backoffMs,
                healRange: detail.healRange || null,
                healPointRepeatCount: detail.healPointRepeatCount || 0
            }));

            const repeatCount = detail.healPointRepeatCount || 0;
            const repeatStuck = repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT;
            if (repeatStuck) {
                Logger.add(LogEvents.tagged('HEALPOINT_STUCK', 'Repeated heal point loop'), {
                    videoId,
                    healRange: detail.healRange || null,
                    repeatCount,
                    errorName: detail.errorName,
                    error: detail.error
                });
            }

            const probationTriggered = probationPolicy?.maybeTriggerProbation
                ? probationPolicy.maybeTriggerProbation(
                    videoId,
                    monitorState,
                    detail.reason || 'play_error',
                    count,
                    CONFIG.stall.PROBATION_AFTER_PLAY_ERRORS
                )
                : false;

            if (repeatStuck && !probationTriggered) {
                if (probationPolicy?.triggerRescan) {
                    probationPolicy.triggerRescan('healpoint_stuck', {
                        videoId,
                        count: repeatCount,
                        trigger: 'healpoint_stuck'
                    });
                } else if (candidateSelector) {
                    candidateSelector.activateProbation('healpoint_stuck');
                    onRescan('healpoint_stuck', {
                        videoId,
                        count: repeatCount,
                        trigger: 'healpoint_stuck'
                    });
                }
            }

            const shouldFailover = monitorsById && monitorsById.size > 1
                && (count >= CONFIG.stall.FAILOVER_AFTER_PLAY_ERRORS || repeatStuck);

            return {
                shouldFailover,
                probationTriggered,
                repeatStuck
            };
        };

        return {
            resetPlayError,
            handlePlayFailure
        };
    };

    return { create };
})();
