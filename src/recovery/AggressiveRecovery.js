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
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            // Enhanced Telemetry
            const bufferEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
            Logger.add('Aggressive recovery telemetry', {
                strategy: 'PASSIVE_WAIT',
                url: originalSrc,
                isBlobUrl: isBlobUrl,
                telemetry: {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    currentTime: video.currentTime,
                    bufferEnd: bufferEnd,
                    paused: video.paused,
                    error: video.error ? video.error.code : null
                }
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

            // Wait for stream to be ready
            await new Promise(resolve => {
                const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / READY_CHECK_INTERVAL_MS;
                let checkCount = 0;
                const interval = setInterval(() => {
                    if (video.readyState >= 2) {
                        clearInterval(interval);
                        Logger.add('Player stabilized successfully', {
                            duration_ms: performance.now() - recoveryStartTime,
                            newReadyState: video.readyState
                        });
                        resolve();
                    } else if (++checkCount >= maxChecks) {
                        clearInterval(interval);
                        Logger.add('Player stabilization timeout', {
                            duration_ms: performance.now() - recoveryStartTime,
                            readyState: video.readyState,
                            networkState: video.networkState
                        });
                        resolve();
                    }
                }, READY_CHECK_INTERVAL_MS);
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
