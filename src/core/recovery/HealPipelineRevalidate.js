// --- HealPipelineRevalidate ---
/**
 * Revalidation helpers for heal points.
 */
const HealPipelineRevalidate = (() => {
    const create = (options) => {
        const poller = options.poller;
        const attemptLogger = options.attemptLogger;
        const recoveryManager = options.recoveryManager;
        const resetRecovery = options.resetRecovery;
        const resetHealPointTracking = options.resetHealPointTracking;
        const getDurationMs = options.getDurationMs;

        const revalidateHealPoint = (video, monitorState, videoId, healPoint, healStartTime) => {
            const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
            if (!freshPoint) {
                if (poller.hasRecovered(video, monitorState)) {
                    attemptLogger.logStaleRecovered(getDurationMs(healStartTime));
                    resetRecovery(monitorState, 'stale_recovered');
                    return { status: 'recovered' };
                }
                attemptLogger.logStaleGone(healPoint, video, videoId);
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, monitorState, 'stale_gone');
                resetHealPointTracking(monitorState);
                return { status: 'stale_gone' };
            }

            if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                attemptLogger.logPointUpdated(healPoint, freshPoint);
            }

            return { status: 'ready', healPoint: freshPoint };
        };

        return { revalidateHealPoint };
    };

    return { create };
})();
