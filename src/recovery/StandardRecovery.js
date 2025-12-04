// --- Standard Recovery ---
/**
 * Simple seek-based recovery strategy.
 * @responsibility Seek to live edge and attempt to play.
 */
const StandardRecovery = (() => {
    return {
        execute: async (video) => {
            Logger.add('[Standard] Starting recovery', {
                currentTime: video.currentTime.toFixed(3),
                paused: video.paused,
                readyState: video.readyState
            });

            if (!video || !video.buffered || video.buffered.length === 0) {
                Logger.add('[Standard] Recovery aborted: no buffer');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const seekTarget = Math.max(0, bufferEnd - CONFIG.player.STANDARD_SEEK_BACK_S);

            Logger.add('[Standard] Seeking to target', {
                seekTarget: seekTarget.toFixed(3),
                bufferEnd: bufferEnd.toFixed(3),
                seekBack: CONFIG.player.STANDARD_SEEK_BACK_S
            });

            video.currentTime = seekTarget;

            // Wait for seek to complete
            await Fn.sleep(100);

            // Attempt to play if paused
            if (video.paused) {
                Logger.add('[Standard] Video paused after seek, attempting play');
                try {
                    await video.play();
                    Logger.add('[Standard] Play initiated successfully', {
                        paused: video.paused,
                        readyState: video.readyState
                    });
                } catch (e) {
                    Logger.add('[Standard] Play failed', {
                        error: e.name,
                        message: e.message
                    });
                    // Don't throw - PlayRetryHandler will handle retry
                }
            }

            Logger.add('[Standard] Recovery complete', {
                seekTo: seekTarget.toFixed(3),
                bufferEnd: bufferEnd.toFixed(3),
                paused: video.paused,
                readyState: video.readyState,
                telemetry: {
                    networkState: video.networkState,
                    buffered: video.buffered.length > 0 ?
                        `[${video.buffered.start(0).toFixed(2)}, ${video.buffered.end(0).toFixed(2)}]` : 'none'
                }
            });

            // Post-Seek Health Check (delayed)
            setTimeout(() => {
                Logger.add('[Standard] Post-seek health check', {
                    currentTime: video.currentTime.toFixed(3),
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

