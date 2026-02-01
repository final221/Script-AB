// --- BackoffManager ---
/**
 * Tracks stall backoff state for no-heal-point scenarios.
 */
const BackoffManager = (() => {
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
                if (now - (monitorState.lastBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markBackoffLog(monitorState, now);
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
