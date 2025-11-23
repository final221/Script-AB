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
            Logger.add('Executing aggressive recovery: forcing stream refresh');
            const recoveryStartTime = performance.now();

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;

            // Wait for stream to be ready
            await new Promise(resolve => {
                const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / READY_CHECK_INTERVAL_MS;
                let checkCount = 0;
                const interval = setInterval(() => {
                    if (video.readyState >= 2) {
                        clearInterval(interval);
                        Logger.add('Stream reloaded.', {
                            duration_ms: performance.now() - recoveryStartTime
                        });
                        resolve();
                    } else if (++checkCount >= maxChecks) {
                        clearInterval(interval);
                        Logger.add('Stream reload timeout during aggressive recovery.');
                        resolve();
                    }
                }, READY_CHECK_INTERVAL_MS);
            });

            // Restore video state
            video.playbackRate = playbackRate;
            video.volume = volume;
            video.muted = muted;
        }
    };
})();
