// --- RecoveryManager ---
/**
 * Coordinates backoff and failover recovery strategies.
 */
const RecoveryManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;

        const backoffManager = BackoffManager.create({ logDebug });
        const failoverManager = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            resetBackoff: backoffManager.resetBackoff
        });

        const handleNoHealPoint = (video, monitorState, reason) => {
            const videoId = getVideoId(video);
            backoffManager.applyBackoff(videoId, monitorState, reason);

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            if (shouldFailover) {
                failoverManager.attemptFailover(videoId, reason, monitorState);
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            if (failoverManager.shouldIgnoreStall(videoId)) {
                return true;
            }
            if (backoffManager.shouldSkip(videoId, monitorState)) {
                return true;
            }
            return false;
        };

        return {
            isFailoverActive: () => failoverManager.isActive(),
            resetFailover: failoverManager.resetFailover,
            resetBackoff: backoffManager.resetBackoff,
            handleNoHealPoint,
            shouldSkipStall,
            onMonitorRemoved: failoverManager.onMonitorRemoved
        };
    };

    return { create };
})();
