// --- BackoffManager ---
/**
 * Tracks stall backoff state for no-heal-point scenarios.
 */
const BackoffManager = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});

        const resetBackoff = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.noHealPointCount > 0 || monitorState.nextHealAllowedTime > 0) {
                logDebug(LogEvents.tagged('BACKOFF', 'Reset'), {
                    reason,
                    previousNoHealPoints: monitorState.noHealPointCount,
                    previousNextHealAllowedMs: monitorState.nextHealAllowedTime
                        ? Math.max(monitorState.nextHealAllowedTime - Date.now(), 0)
                        : 0
                });
            }
            monitorState.noHealPointCount = 0;
            monitorState.nextHealAllowedTime = 0;
        };

        const applyBackoff = (videoId, monitorState, reason) => {
            if (!monitorState) return;
            const count = (monitorState.noHealPointCount || 0) + 1;
            const base = CONFIG.stall.NO_HEAL_POINT_BACKOFF_BASE_MS;
            const max = CONFIG.stall.NO_HEAL_POINT_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.noHealPointCount = count;
            monitorState.nextHealAllowedTime = Date.now() + backoffMs;

            Logger.add(LogEvents.tagged('BACKOFF', 'No heal point'), {
                videoId,
                reason,
                noHealPointCount: count,
                backoffMs,
                nextHealAllowedInMs: backoffMs
            });
        };

        const shouldSkip = (videoId, monitorState) => {
            const now = Date.now();
            if (monitorState?.nextHealAllowedTime && now < monitorState.nextHealAllowedTime) {
                if (now - (monitorState.lastBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastBackoffLogTime = now;
                    logDebug(LogEvents.tagged('BACKOFF', 'Stall skipped due to backoff'), {
                        videoId,
                        remainingMs: monitorState.nextHealAllowedTime - now,
                        noHealPointCount: monitorState.noHealPointCount
                    });
                }
                return true;
            }
            return false;
        };

        return {
            resetBackoff,
            applyBackoff,
            shouldSkip
        };
    };

    return { create };
})();
