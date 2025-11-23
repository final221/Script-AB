// --- Play Retry Handler ---
/**
 * Handles video.play() with retry logic and exponential backoff.
 * @responsibility Ensure reliable playback resumption after recovery.
 */
const PlayRetryHandler = (() => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 300;

    return {
        retry: async (video, context = 'unknown') => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const playStartTime = performance.now();
                try {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} (${context})`, {
                        before: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime
                        },
                    });

                    await video.play();
                    await Fn.sleep(50);

                    if (!video.paused) {
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
                    await Fn.sleep(BASE_DELAY_MS * attempt);
                }
            }

            Logger.add('All play attempts exhausted.', { context });
            return false;
        }
    };
})();
