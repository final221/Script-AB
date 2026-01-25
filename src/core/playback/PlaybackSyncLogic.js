// --- PlaybackSyncLogic ---
/**
 * Sync drift sampling helper.
 */
const PlaybackSyncLogic = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const state = options.state;
        const logDebugLazy = options.logDebugLazy || (() => {});

        const logSyncStatus = () => {
            const now = Date.now();
            if (video.paused || video.readyState < 2) {
                return;
            }
            if (!state.lastSyncWallTime) {
                state.lastSyncWallTime = now;
                state.lastSyncMediaTime = video.currentTime;
                return;
            }
            const wallDelta = now - state.lastSyncWallTime;
            if (wallDelta < CONFIG.monitoring.SYNC_SAMPLE_MS) {
                return;
            }
            const mediaDelta = (video.currentTime - state.lastSyncMediaTime) * 1000;
            state.lastSyncWallTime = now;
            state.lastSyncMediaTime = video.currentTime;

            if (wallDelta <= 0) {
                return;
            }

            const rate = mediaDelta / wallDelta;
            const driftMs = wallDelta - mediaDelta;
            const ranges = BufferGapFinder.getBufferRanges(video);
            const bufferEndDelta = ranges.length
                ? (ranges[ranges.length - 1].end - video.currentTime)
                : null;

            const shouldLog = (now - state.lastSyncLogTime >= CONFIG.logging.SYNC_LOG_MS)
                || driftMs >= CONFIG.monitoring.SYNC_DRIFT_MAX_MS
                || rate <= CONFIG.monitoring.SYNC_RATE_MIN;

            if (!shouldLog) {
                return;
            }
            state.lastSyncLogTime = now;
            logDebugLazy(LogEvents.tagged('SYNC', 'Playback drift sample'), () => ({
                wallDeltaMs: wallDelta,
                mediaDeltaMs: Math.round(mediaDelta),
                driftMs: Math.round(driftMs),
                rate: Number.isFinite(rate) ? rate.toFixed(3) : null,
                bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null
            }));
        };

        return { logSyncStatus };
    };

    return { create };
})();
