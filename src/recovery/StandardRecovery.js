// --- Standard Recovery ---
/**
 * Simple seek-based recovery strategy.
 * @responsibility Seek to live edge without disrupting stream.
 */
const StandardRecovery = (() => {
    const SEEK_OFFSET_S = 0.5;

    return {
        execute: (video) => {
            Logger.add('Executing standard recovery: seeking');

            if (!video || !video.buffered || video.buffered.length === 0) {
                Logger.add('Standard recovery aborted: no buffer');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            video.currentTime = bufferEnd - SEEK_OFFSET_S;

            Logger.add('Standard recovery complete', {
                seekTo: video.currentTime,
                bufferEnd
            });
        }
    };
})();
