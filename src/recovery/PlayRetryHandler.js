// --- Play Retry Handler ---
/**
 * Manages persistent play attempts with exponential backoff.
 * @responsibility
 * 1. Validate video state before playing.
 * 2. Execute play attempts with backoff.
 * 3. Apply micro-seeks if stuck.
 * 4. Handle errors and decide when to give up.
 */
const PlayRetryHandler = (() => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 150;

    return {
        /**
         * Attempts to force the video to play with retries.
         * @param {HTMLVideoElement} video - The video element
         * @param {string} context - Context for logging (e.g., 'post-recovery')
         * @returns {Promise<boolean>} True if successful
         */
        retry: async (video, context = 'general') => {
            if (!PlayValidator.validatePlayable(video)) {
                Logger.add('[PlayRetry] Video not ready for playback', {
                    readyState: video.readyState,
                    error: video.error ? video.error.code : null
                });
                return false;
            }

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    // 1. Micro-seek Strategy
                    if (MicroSeekStrategy.shouldApplyMicroSeek(video, attempt)) {
                        await MicroSeekStrategy.executeMicroSeek(video);
                    }

                    // 2. Play Execution
                    await PlayExecutor.attemptPlay(video);

                    // 3. Verification
                    const isPlaying = await PlayValidator.waitForPlaying(video);
                    if (isPlaying) {
                        Logger.add(`[PlayRetry] Success (${context})`, { attempt });
                        return true;
                    } else {
                        throw new Error('Playback verification failed');
                    }

                } catch (error) {
                    const errorInfo = PlayExecutor.categorizePlayError(error);

                    // Special handling for AbortError (often temporary race condition)
                    if (errorInfo.name === 'AbortError') {
                        Logger.add(`[PlayRetry] AbortError detected, retrying immediately...`, { attempt });
                        await Fn.sleep(50); // Tiny backoff
                        attempt--; // Don't count this as a full attempt
                        if (attempt < 0) attempt = 0; // Safety
                        continue;
                    }

                    Logger.add(`[PlayRetry] Attempt ${attempt} failed`, {
                        error: errorInfo.name,
                        message: errorInfo.message,
                        fatal: errorInfo.isFatal
                    });

                    if (errorInfo.isFatal) return false;

                    if (attempt < MAX_RETRIES) {
                        await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                    }
                }
            }

            Logger.add(`[PlayRetry] Failed after ${MAX_RETRIES} attempts`);
            return false;
        }
    };
})();
