// --- Standard Recovery ---
/**
 * Simple seek-based recovery strategy.
 * @responsibility Seek to live edge without disrupting stream.
 */
const StandardRecovery = (() => {
    // const SEEK_OFFSET_S = 0.5; // Removed in favor of CONFIG.player.STANDARD_SEEK_BACK_S

    return {
        execute: (video) => {
            Logger.add('Executing standard recovery: seeking');

            if (!video || !video.buffered || video.buffered.length === 0) {
                Logger.add('Standard recovery aborted: no buffer');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const seekTarget = Math.max(0, bufferEnd - CONFIG.player.STANDARD_SEEK_BACK_S);
            video.currentTime = seekTarget;

            Logger.add('Standard recovery complete', {
                seekTo: seekTarget,
                bufferEnd
            });
        }
    };
})();
