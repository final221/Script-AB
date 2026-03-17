// @module PlaybackSyncLogic
// @depends PlaybackProgressLogic
// --- PlaybackSyncLogic ---
/**
 * Sync drift sampling helper.
 */
const PlaybackSyncLogic = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const state = options.state;
        const logDebugLazy = options.logDebugLazy || (() => {});
        const onDegradedSync = options.onDegradedSync || (() => {});

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
            const degraded = driftMs >= CONFIG.monitoring.SYNC_DRIFT_MAX_MS
                || rate <= CONFIG.monitoring.SYNC_RATE_MIN;
            const severe = driftMs >= CONFIG.monitoring.SYNC_SEVERE_DRIFT_MS
                || rate <= CONFIG.monitoring.SYNC_SEVERE_RATE_MIN;
            state.lastSyncRate = rate;
            state.lastSyncDriftMs = driftMs;
            state.degradedSyncCount = degraded
                ? (state.degradedSyncCount || 0) + 1
                : 0;
            if (severe && state.degradedSyncCount < CONFIG.monitoring.DEGRADED_ACTIVE_SAMPLE_COUNT) {
                state.degradedSyncCount = CONFIG.monitoring.DEGRADED_ACTIVE_SAMPLE_COUNT;
            }
            const ranges = BufferGapFinder.getBufferRanges(video);
            const bufferEndDelta = ranges.length
                ? (ranges[ranges.length - 1].end - video.currentTime)
                : null;

            if (degraded) {
                onDegradedSync({
                    currentTime: video.currentTime,
                    driftMs: Math.round(driftMs),
                    rate,
                    degraded: true,
                    severe,
                    degradedSyncCount: state.degradedSyncCount,
                    bufferEndDeltaS: bufferEndDelta
                });
            }

            const shouldLog = (now - state.lastSyncLogTime >= CONFIG.logging.SYNC_LOG_MS)
                || degraded;

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
