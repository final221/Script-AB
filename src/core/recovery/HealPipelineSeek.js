// --- HealPipelineSeek ---
/**
 * Seek and retry helpers for heal attempts.
 */
const HealPipelineSeek = (() => {
    const create = (options) => {
        const attemptLogger = options.attemptLogger;

        const attemptSeekWithRetry = async (video, targetPoint) => {
            const attemptSeekAndPlay = async (point, label) => {
                if (label) {
                    attemptLogger.logRetry(label, point);
                }
                return LiveEdgeSeeker.seekAndPlay(video, point);
            };

            let result = await attemptSeekAndPlay(targetPoint, null);
            let finalPoint = targetPoint;

            if (!result.success && HealAttemptUtils.isAbortError(result)) {
                await Fn.sleep(CONFIG.recovery.HEAL_RETRY_DELAY_MS);
                const retryPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                if (retryPoint) {
                    finalPoint = retryPoint;
                    result = await attemptSeekAndPlay(retryPoint, 'abort_error');
                } else {
                    attemptLogger.logRetrySkip(video, 'abort_error');
                }
            }

            return { result, finalPoint };
        };

        return { attemptSeekWithRetry };
    };

    return { create };
})();
