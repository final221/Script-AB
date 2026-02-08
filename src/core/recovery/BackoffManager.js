// @module BackoffManager
// --- BackoffManager ---
/**
 * Tracks stall backoff state for no-heal-point scenarios.
 */
const BackoffManager = (() => {
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

        const resetBackoff = (monitorState, reason) => {
            if (!monitorState) return;
            const previousNoHealPoints = monitorState.noHealPointCount;
            const previousNextHealAllowedMs = monitorState.nextHealAllowedTime
                ? Math.max(monitorState.nextHealAllowedTime - Date.now(), 0)
                : 0;
            if (previousNoHealPoints > 0 || previousNextHealAllowedMs > 0) {
                logDebug(LogEvents.tagged('BACKOFF', 'Reset'), {
                    reason,
                    previousNoHealPoints,
                    previousNextHealAllowedMs
                });
            }
            PlaybackStateStore.resetNoHealPointState(monitorState);
        };

        const applyBackoff = (videoId, monitorState, reason) => {
            if (!monitorState) return;
            const count = (monitorState.noHealPointCount || 0) + 1;
            const base = CONFIG.stall.NO_HEAL_POINT_BACKOFF_BASE_MS;
            const max = CONFIG.stall.NO_HEAL_POINT_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            PlaybackStateStore.setNoHealPointBackoff(
                monitorState,
                count,
                Date.now() + backoffMs
            );

            Logger.add(LogEvents.tagged('BACKOFF', 'No heal point'), {
                videoId,
                reason,
                noHealPointCount: count,
                backoffMs,
                nextHealAllowedInMs: backoffMs
            });
        };

        const getBackoffStatus = (monitorState, now = Date.now()) => {
            if (monitorState?.nextHealAllowedTime && now < monitorState.nextHealAllowedTime) {
                return {
                    shouldSkip: true,
                    remainingMs: monitorState.nextHealAllowedTime - now,
                    noHealPointCount: monitorState.noHealPointCount || 0
                };
            }
            return { shouldSkip: false };
        };

        const shouldSkip = (videoId, monitorState) => {
            const now = Date.now();
            const status = getBackoffStatus(monitorState, now);
            if (status.shouldSkip) {
                const lastLogTime = monitorState.lastBackoffLogTime || 0;
                const bucket = backoffBucket(status.remainingMs);
                const bucketChanged = bucket !== (monitorState.lastBackoffRemainingBucket || 0);
                const countChanged = status.noHealPointCount !== (monitorState.lastBackoffNoHealPointCount || 0);
                const heartbeatDue = (now - lastLogTime) >= (CONFIG.logging.BACKOFF_LOG_INTERVAL_MS * 6);
                const shouldLog = bucketChanged || countChanged || heartbeatDue;
                if (shouldLog && (now - lastLogTime) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markBackoffLog(monitorState, now);
                    monitorState.lastBackoffRemainingBucket = bucket;
                    monitorState.lastBackoffNoHealPointCount = status.noHealPointCount;
                    logDebug(LogEvents.tagged('BACKOFF', 'Stall skipped due to backoff'), {
                        videoId,
                        remainingMs: status.remainingMs,
                        noHealPointCount: status.noHealPointCount
                    });
                }
                return true;
            }
            return false;
        };

        return {
            resetBackoff,
            applyBackoff,
            getBackoffStatus,
            shouldSkip
        };
    };

    return { create };
})();
