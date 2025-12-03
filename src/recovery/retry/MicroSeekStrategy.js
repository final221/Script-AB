// --- Micro Seek Strategy ---
/**
 * Implements intelligent seeking to unstick playback.
 */
const MicroSeekStrategy = (() => {
    /**
     * Determines if a micro-seek should be applied.
     * @param {HTMLVideoElement} video - The video element
     * @param {number} attempt - Current retry attempt number
     * @returns {boolean} True if micro-seek is recommended
     */
    const shouldApplyMicroSeek = (video, attempt) => {
        // Apply on later attempts or if buffer is stuck
        return attempt > 1 || (video.readyState >= 2 && video.paused);
    };

    /**
     * Calculates the optimal seek target.
     * @param {HTMLVideoElement} video - The video element
     * @returns {number} Target timestamp
     */
    const calculateSeekTarget = (video) => {
        // Prefer seeking forward slightly to hit buffered content
        if (video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1);
            if (end > video.currentTime + 0.1) {
                return Math.min(video.currentTime + 0.05, end - 0.1);
            }
        }
        // Fallback: tiny forward seek or stay in place
        return video.currentTime + 0.001;
    };

    /**
     * Executes a micro-seek operation.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Promise<void>} Resolves when seek completes
     */
    const executeMicroSeek = (video) => {
        return new Promise((resolve) => {
            const target = calculateSeekTarget(video);

            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                resolve();
            };

            // Safety timeout in case seeked never fires
            const timeoutId = setTimeout(() => {
                video.removeEventListener('seeked', onSeeked);
                Logger.add('[PlayRetry] Micro-seek timeout');
                resolve();
            }, 1000);

            video.addEventListener('seeked', () => {
                clearTimeout(timeoutId);
                onSeeked();
            }, { once: true });

            video.currentTime = target;
            Logger.add('[PlayRetry] Applied micro-seek', { target: target.toFixed(3) });
        });
    };

    return {
        shouldApplyMicroSeek,
        calculateSeekTarget,
        executeMicroSeek
    };
})();
