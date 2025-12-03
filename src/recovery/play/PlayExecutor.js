// --- Play Executor ---
/**
 * Executes play attempts and handles errors.
 */
const PlayExecutor = (() => {
    /**
     * Attempts to play the video once.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Promise<void>} Resolves on success, rejects with error
     */
    const attemptPlay = async (video) => {
        try {
            await video.play();
        } catch (error) {
            throw error;
        }
    };

    /**
     * Categorizes a play error for logging and decision making.
     * @param {Error} error - The error thrown by video.play()
     * @returns {{name: string, isFatal: boolean, message: string}}
     */
    const categorizePlayError = (error) => {
        const name = error.name || 'UnknownError';
        const message = error.message || 'No message';

        return {
            name,
            message,
            isFatal: isFatalError(name)
        };
    };

    /**
     * Determines if an error is fatal (should stop retries).
     * @param {string} errorName - The error name
     * @returns {boolean} True if fatal
     */
    const isFatalError = (errorName) => {
        return errorName === 'NotAllowedError' || errorName === 'NotSupportedError';
    };

    return {
        attemptPlay,
        categorizePlayError,
        isFatalError
    };
})();
