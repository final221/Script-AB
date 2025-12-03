// --- Play Validator ---
/**
 * Validates video state for playback.
 */
const PlayValidator = (() => {
    /**
     * Checks if the video is in a state that allows playback.
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if playable
     */
    const validatePlayable = (video) => {
        if (!video) return false;
        if (video.error) return false;
        if (video.readyState < 2) return false; // HAVE_CURRENT_DATA
        return true;
    };

    /**
     * Waits for the video to actually start playing.
     * @param {HTMLVideoElement} video - The video element
     * @param {number} timeoutMs - Max wait time
     * @returns {Promise<boolean>} True if playing detected
     */
    const waitForPlaying = (video, timeoutMs = 2000) => {
        return new Promise((resolve) => {
            if (!video.paused && video.readyState >= 3) {
                resolve(true);
                return;
            }

            let resolved = false;
            const cleanup = () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('timeupdate', onTimeUpdate);
            };

            const onPlaying = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            const onTimeUpdate = () => {
                if (!resolved && !video.paused) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            video.addEventListener('playing', onPlaying, { once: true });
            video.addEventListener('timeupdate', onTimeUpdate, { once: true });

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
        validatePlayable,
        waitForPlaying
    };
})();
