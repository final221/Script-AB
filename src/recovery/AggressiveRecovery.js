// --- Aggressive Recovery ---
/**
 * Stream refresh recovery strategy via src clearing.
 * @responsibility Force stream refresh when stuck at buffer end.
 */
const AggressiveRecovery = (() => {
    const READY_CHECK_INTERVAL_MS = 100;

    return {
        execute: async (video) => {
            Metrics.increment('aggressive_recoveries');
            Logger.add('Executing aggressive recovery: waiting for player to stabilize');
            const recoveryStartTime = performance.now();

            // Log initial telemetry
            const initialState = RecoveryUtils.captureVideoState(video);
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            Logger.add('Aggressive recovery telemetry', {
                strategy: 'PASSIVE_WAIT',
                url: originalSrc,
                isBlobUrl,
                telemetry: initialState
            });

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;

            // CRITICAL: DO NOT seek, DO NOT reload, DO NOT touch the src!
            // Analysis of logs showed that ANY manipulation (seeking to infinity, bufferEnd+5s, etc.)
            // causes massive A/V desync (100+ seconds) or AbortErrors.
            // The player is smart enough to recover on its own. Our job is to just wait.
            // This is the approach from the early version that worked reliably.

            // Wait for stream to be ready (with forensic logging)
            await RecoveryUtils.waitForStability(video, {
                startTime: recoveryStartTime,
                timeoutMs: CONFIG.timing.PLAYBACK_TIMEOUT_MS,
                checkIntervalMs: READY_CHECK_INTERVAL_MS
            });

            // Restore video state
            try {
                video.playbackRate = playbackRate;
                video.volume = volume;
                video.muted = muted;
            } catch (e) {
                Logger.add('Failed to restore video state', { error: e.message });
            }
        }
    };
})();
