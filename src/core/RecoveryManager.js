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
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});

        const policy = RecoveryPolicy.create({
            logDebug,
            candidateSelector,
            onRescan,
            onPersistentFailure,
            monitorsById,
            getVideoId
        });
        const failoverManager = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            resetBackoff: policy.resetBackoff
        });
        const probeCandidate = failoverManager.probeCandidate;
        const handleNoHealPoint = (videoOrContext, monitorStateOverride, reason) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, { reason });
            const result = policy.handleNoHealPoint(context, reason);
            if (result.shouldFailover) {
                failoverManager.attemptFailover(context.videoId, reason, context.monitorState);
            }
            if (result.refreshed) {
                return;
            }
        };

        const resetPlayError = policy.resetPlayError;

        const handlePlayFailure = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, detail);
            const result = policy.handlePlayFailure(context, detail);
            const shouldConsider = result.probationTriggered || result.repeatStuck || result.shouldFailover;
            if (!shouldConsider) {
                return;
            }
            const beforeActive = candidateSelector.getActiveId();
            candidateSelector.evaluateCandidates('play_error');
            const afterActive = candidateSelector.getActiveId();
            if (result.shouldFailover && afterActive === beforeActive) {
                failoverManager.attemptFailover(context.videoId, detail.reason || 'play_error', context.monitorState);
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            if (failoverManager.shouldIgnoreStall(videoId)) {
                return true;
            }
            const context = RecoveryContext.create(
                monitorsById?.get(videoId)?.video || null,
                monitorState,
                getVideoId,
                { videoId }
            );
            return policy.shouldSkipStall(context);
        };

        return {
            isFailoverActive: () => failoverManager.isActive(),
            resetFailover: failoverManager.resetFailover,
            resetBackoff: policy.resetBackoff,
            resetPlayError,
            handleNoHealPoint,
            handlePlayFailure,
            shouldSkipStall,
            probeCandidate,
            onMonitorRemoved: failoverManager.onMonitorRemoved
        };
    };

    return { create };
})();
