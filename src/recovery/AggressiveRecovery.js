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
            const recoveryStartTime = performance.now();
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            // Enhanced Telemetry
            const bufferEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
            Logger.add('Executing aggressive recovery', {
                strategy: isBlobUrl ? 'LIVE_EDGE_SEEK' : 'SRC_RESET',
                url: originalSrc,
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

            // Execute Strategy
            if (isBlobUrl) {
                // FIX: Do NOT call load() or clear src for Blob URLs to avoid Error #4000 and AbortErrors.
                // Seeking to infinity forces the player to jump to the live edge without resetting the source.
                video.currentTime = 999999;
            } else {
                Logger.add('Standard URL detected - reloading via empty src');
                video.src = '';
                video.load();
            }

            // Wait for stream to be ready
            await new Promise(resolve => {
                const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / READY_CHECK_INTERVAL_MS;
                let checkCount = 0;
                const interval = setInterval(() => {
                    if (video.readyState >= 2) {
                        clearInterval(interval);
                        Logger.add('Stream reloaded/seeked successfully', {
                            duration_ms: performance.now() - recoveryStartTime,
                            newReadyState: video.readyState
                        });
                        resolve();
                    } else if (++checkCount >= maxChecks) {
                        clearInterval(interval);
                        Logger.add('Stream recovery timeout', {
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
