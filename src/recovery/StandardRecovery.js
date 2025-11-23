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
                bufferEnd,
                telemetry: {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    buffered: video.buffered.length > 0 ?
                        `[${video.buffered.start(0).toFixed(2)}, ${video.buffered.end(0).toFixed(2)}]` : 'none'
                }
            });

            // Post-Seek Health Check
            setTimeout(() => {
                Logger.add('Post-seek health check', {
                    currentTime: video.currentTime,
                    readyState: video.readyState,
                    networkState: video.networkState,
                    paused: video.paused,
                    bufferGap: video.buffered.length > 0 ?
                        (video.currentTime - video.buffered.end(video.buffered.length - 1)).toFixed(3) : 'unknown'
                });
            }, 1000);
        }
    };
})();
