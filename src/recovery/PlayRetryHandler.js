// --- Play Retry Handler ---
/**
 * Handles video.play() with retry logic and exponential backoff.
 * @responsibility Ensure reliable playback resumption after recovery.
 */
const PlayRetryHandler = (() => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 300;

    /**
     * Waits for the video to actually start playing.
     * @param {HTMLVideoElement} video
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    const waitForPlaying = (video, timeoutMs = 1000) => {
        return new Promise((resolve) => {
            if (!video.paused && video.readyState >= 3) {
                resolve(true);
                return;
            }

            let resolved = false;
            const cleanup = () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('pause', onPause);
            };

            const onPlaying = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            const onPause = () => {
                // If it pauses again immediately, we might fail this attempt,
                // but we let the timeout or the next check handle the final verdict.
            };

            video.addEventListener('playing', onPlaying);
            video.addEventListener('pause', onPause);

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(false);
                }
            }, timeoutMs);
        });
    };

    return {
        retry: async (video, context = 'unknown') => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const playStartTime = performance.now();

                // Strategy: Seek slightly if previous attempts failed to "unstuck" the player
                if (attempt > 1) {
                    const target = Math.min(video.currentTime + 0.1, video.duration - 0.1);
                    if (target > 0 && Number.isFinite(target)) {
                        Logger.add(`[RECOVERY] Attempting seek-to-unstuck to ${target.toFixed(3)}`, { context });
                        video.currentTime = target;
                    }
                }

                try {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} (${context})`, {
                        before: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime,
                            error: video.error ? video.error.code : null
                        },
                    });

                    await video.play();

                    // Wait for the 'playing' event to confirm success
                    const isPlaying = await waitForPlaying(video, 500 * attempt);
                    await Fn.sleep(50); // Small buffer after event

                    if (isPlaying && !video.paused) {
                        Logger.add(`Play attempt ${attempt} SUCCESS`, {
                            context,
                            duration_ms: performance.now() - playStartTime
                        });
                        return true;
                    }

                    Logger.add(`Play attempt ${attempt} FAILED: video still paused`, {
                        context,
                        duration_ms: performance.now() - playStartTime
                    });
                } catch (error) {
                    Logger.add(`Play attempt ${attempt} threw error`, {
                        context,
                        error: error.message,
                        duration_ms: performance.now() - playStartTime
                    });

                    if (error.name === 'NotAllowedError') {
                        return false;
                    }
                }

                if (attempt < MAX_RETRIES) {
                    await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                }
            }

            Logger.add('All play attempts exhausted.', { context });
            return false;
        }
    };
})();
