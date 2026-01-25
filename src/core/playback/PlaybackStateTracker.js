// --- PlaybackStateTracker ---
/**
 * Shared playback state tracking for PlaybackMonitor.
 */
const PlaybackStateTracker = (() => {
    const create = (video, videoId, logDebug) => {
        const state = PlaybackStateStore.create(video);

        const logHelper = PlaybackLogHelper.create({ video, videoId, state });

        const logDebugLazy = (messageOrFactory, detailFactory) => {
            if (!CONFIG.debug) return;
            if (typeof messageOrFactory === 'function') {
                const result = messageOrFactory();
                if (!result) return;
                logDebug(result.message, result.detail || {});
                return;
            }
            logDebug(messageOrFactory, detailFactory ? detailFactory() : {});
        };

        const getCurrentTime = () => (
            Number.isFinite(video.currentTime) ? Number(video.currentTime.toFixed(3)) : null
        );

        const resetLogic = PlaybackResetLogic.create({
            video,
            videoId,
            state,
            logDebugLazy
        });

        const progressLogic = PlaybackProgressLogic.create({
            video,
            videoId,
            state,
            logHelper,
            logDebugLazy,
            getCurrentTime,
            clearResetPending: resetLogic.clearResetPending,
            evaluateResetState: resetLogic.evaluateResetState
        });

        const syncLogic = PlaybackSyncLogic.create({
            video,
            state,
            logDebugLazy
        });

        const starvationLogic = PlaybackStarvationLogic.create({
            state,
            logDebugLazy
        });

        return {
            state,
            updateProgress: progressLogic.updateProgress,
            markStallEvent: progressLogic.markStallEvent,
            markReady: progressLogic.markReady,
            handleReset: resetLogic.handleReset,
            shouldSkipUntilProgress: progressLogic.shouldSkipUntilProgress,
            evaluateResetPending: resetLogic.evaluateResetPending,
            clearResetPending: resetLogic.clearResetPending,
            logSyncStatus: syncLogic.logSyncStatus,
            updateBufferStarvation: starvationLogic.updateBufferStarvation
        };
    };

    return { create };
})();

