// --- HealPipelinePoller ---
/**
 * Polling helpers for heal points.
 */
const HealPipelinePoller = (() => {
    const create = (options) => {
        const poller = options.poller;
        const attemptLogger = options.attemptLogger;
        const recoveryManager = options.recoveryManager;
        const resetRecovery = options.resetRecovery;
        const resetHealPointTracking = options.resetHealPointTracking;
        const getDurationMs = options.getDurationMs;
        const onDetached = options.onDetached || (() => {});

        const handlePollAbort = (video, videoId, reason) => {
            const abortReason = reason || 'poll_abort';
            Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted during polling'), {
                reason: abortReason,
                videoId
            });
            onDetached(video, abortReason);
        };

        const pollForHealPoint = async (video, monitorState, videoId, healStartTime) => {
            const pollResult = await poller.pollForHealPoint(
                video,
                monitorState,
                CONFIG.stall.HEAL_TIMEOUT_S * 1000
            );

            if (pollResult.aborted) {
                handlePollAbort(video, videoId, pollResult.reason);
                return { status: 'aborted' };
            }

            const healPoint = pollResult.healPoint;
            if (!healPoint) {
                if (poller.hasRecovered(video, monitorState)) {
                    attemptLogger.logSelfRecovered(getDurationMs(healStartTime), video, videoId);
                    resetRecovery(monitorState, 'self_recovered');
                    return { status: 'recovered' };
                }

                const noPointDuration = getDurationMs(healStartTime);
                attemptLogger.logNoHealPoint(noPointDuration, video, videoId);
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
                resetHealPointTracking(monitorState);
                return { status: 'no_point' };
            }

            return { status: 'found', healPoint };
        };

        return { pollForHealPoint };
    };

    return { create };
})();
