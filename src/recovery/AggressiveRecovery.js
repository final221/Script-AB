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
            const muted = video.muted;
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            // Clear and reload stream
            if (isBlobUrl) {
                Logger.add('Blob URL detected - attempting reload cycle', { url: originalSrc });

                // NOTE: This strategy is risky. If the Blob URL has been revoked by the browser 
                // or Twitch's player code, reusing it here will fail (Error #4000).
                // We log each step to diagnose if this is the cause of the crash.

                Logger.add('Step 1: Clearing video.src');
                video.src = '';
                video.load();

                await Fn.sleep(100);

                Logger.add('Step 2: Restoring original Blob URL');
                video.src = originalSrc;
                video.load();
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
