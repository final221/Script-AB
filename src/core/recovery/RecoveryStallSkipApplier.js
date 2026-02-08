// --- RecoveryStallSkipApplier ---
// @module RecoveryStallSkipApplier
// @depends RecoveryLogDetails
/**
 * Applies stall skip decisions and throttled skip logging.
 */
const RecoveryStallSkipApplier = (() => {
    const backoffBucket = (remainingMs) => {
        if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
        if (remainingMs <= 5000) return 1;
        if (remainingMs <= 15000) return 2;
        if (remainingMs <= 30000) return 3;
        if (remainingMs <= 45000) return 4;
        return 5;
    };

    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});

        const shouldLogBackoffSkip = (monitorState, backoff, now) => {
            if (!monitorState || !backoff) return false;
            const lastLogTime = monitorState.lastBackoffLogTime || 0;
            const bucket = backoffBucket(backoff.remainingMs);
            const bucketChanged = bucket !== (monitorState.lastBackoffRemainingBucket || 0);
            const count = backoff.noHealPointCount || 0;
            const countChanged = count !== (monitorState.lastBackoffNoHealPointCount || 0);
            const heartbeatDue = (now - lastLogTime) >= (CONFIG.logging.BACKOFF_LOG_INTERVAL_MS * 6);
            const shouldLog = bucketChanged || countChanged || heartbeatDue;
            if (!shouldLog) return false;
            if ((now - lastLogTime) <= CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) return false;
            monitorState.lastBackoffRemainingBucket = bucket;
            monitorState.lastBackoffNoHealPointCount = count;
            return true;
        };

        const apply = (decision) => {
            if (!decision || decision.type !== 'stall_skip') return false;
            const data = decision.data || {};
            if (!data.shouldSkip) return false;
            const context = decision.context || {};
            const videoId = context.videoId;
            const monitorState = context.monitorState;
            const now = context.now;
            if (!monitorState) return true;

            if (data.reason === 'backoff' && data.backoff) {
                if (shouldLogBackoffSkip(monitorState, data.backoff, now)) {
                    PlaybackStateStore.markBackoffLog(monitorState, now);
                    logDebug(LogEvents.tagged('BACKOFF', 'Stall skipped due to backoff'), {
                        videoId,
                        remainingMs: data.backoff.remainingMs,
                        noHealPointCount: data.backoff.noHealPointCount
                    });
                }
                return true;
            }

            if (data.reason === 'buffer_starve' && data.bufferStarve) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug(LogEvents.tagged('STARVE_SKIP', 'Stall skipped due to buffer starvation'), {
                        videoId,
                        remainingMs: data.bufferStarve.remainingMs,
                        bufferAhead: data.bufferStarve.bufferAhead !== null
                            ? data.bufferStarve.bufferAhead.toFixed(3)
                            : null
                    });
                }
                return true;
            }

            if (data.reason === 'play_backoff' && data.playBackoff) {
                if (now - (monitorState.lastPlayBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markPlayBackoffLog(monitorState, now);
                    logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Stall skipped due to play backoff'), {
                        videoId,
                        remainingMs: data.playBackoff.remainingMs,
                        playErrorCount: data.playBackoff.playErrorCount
                    });
                }
                return true;
            }

            if (data.reason === 'self_recover' && data.selfRecover) {
                if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastSelfRecoverSkipLogTime = now;
                    logDebug(LogEvents.tagged('SELF_RECOVER_SKIP', 'Stall skipped for self-recovery window'), {
                        videoId,
                        stalledForMs: data.selfRecover.stalledForMs,
                        graceMs: data.selfRecover.graceMs,
                        extraGraceMs: data.selfRecover.extraGraceMs,
                        signals: data.selfRecover.signals,
                        bufferAhead: data.selfRecover.bufferAhead,
                        bufferStarved: data.selfRecover.bufferStarved
                    });
                }
                return true;
            }

            return true;
        };

        return { apply };
    };

    return { create };
})();
