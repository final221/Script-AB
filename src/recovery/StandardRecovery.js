// --- Standard Recovery ---
/**
 * Simple recovery strategy - GENTLER than before.
 * REFACTORED: Try play() first, only seek as fallback.
 * - Previous approach (seek + play) was too aggressive
 * - Now: try play → if stuck, gentle seek → try play again
 */
const StandardRecovery = (() => {
    const name = 'StandardRecovery';

    // Helper to capture state for logging
    const getState = (video) => ({
        currentTime: video.currentTime?.toFixed(3),
        paused: video.paused,
        readyState: video.readyState,
        networkState: video.networkState,
        buffered: video.buffered?.length > 0
            ? `[${video.buffered.start(0).toFixed(2)}, ${video.buffered.end(video.buffered.length - 1).toFixed(2)}]`
            : 'empty'
    });

    return {
        name,

        execute: async (video) => {
            const startTime = performance.now();

            Logger.add('[STANDARD:ENTER] Starting gentle recovery', {
                state: getState(video)
            });

            if (!video) {
                Logger.add('[STANDARD:ABORT] No video element');
                return;
            }

            // STEP 1: If video is paused, just try to play
            if (video.paused) {
                Logger.add('[STANDARD:STEP1] Video paused, attempting play()');
                try {
                    await video.play();
                    await Fn.sleep(200); // Brief wait to check if it worked

                    if (!video.paused) {
                        Logger.add('[STANDARD:SUCCESS] Play succeeded on first attempt', {
                            duration: (performance.now() - startTime).toFixed(0) + 'ms',
                            state: getState(video)
                        });
                        return; // Success! No need to seek
                    }
                    Logger.add('[STANDARD:STEP1_FAIL] Play returned but video still paused');
                } catch (e) {
                    Logger.add('[STANDARD:STEP1_ERROR] Play failed', {
                        error: e.name,
                        message: e.message
                    });
                }
            } else {
                Logger.add('[STANDARD:STEP1_SKIP] Video already playing', {
                    readyState: video.readyState
                });
                // Check if it's actually progressing
                const timeBefore = video.currentTime;
                await Fn.sleep(500);
                const timeAfter = video.currentTime;

                if (Math.abs(timeAfter - timeBefore) > 0.1) {
                    Logger.add('[STANDARD:SUCCESS] Video is playing and progressing', {
                        progress: (timeAfter - timeBefore).toFixed(3) + 's',
                        state: getState(video)
                    });
                    return; // Actually playing fine
                }
                Logger.add('[STANDARD:STUCK] Video not paused but not progressing', {
                    timeBefore: timeBefore.toFixed(3),
                    timeAfter: timeAfter.toFixed(3)
                });
            }

            // STEP 2: If play didn't work, try gentle seek (only if we have buffer)
            if (!video.buffered || video.buffered.length === 0) {
                Logger.add('[STANDARD:ABORT] No buffer available for seek');
                return;
            }

            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const seekTarget = Math.max(0, bufferEnd - 2); // Just 2 seconds back (was 3.5)

            Logger.add('[STANDARD:STEP2] Attempting gentle seek', {
                from: video.currentTime.toFixed(3),
                to: seekTarget.toFixed(3),
                bufferEnd: bufferEnd.toFixed(3)
            });

            try {
                video.currentTime = seekTarget;
                await Fn.sleep(200);
            } catch (e) {
                Logger.add('[STANDARD:SEEK_ERROR] Seek failed', { error: e.message });
            }

            // STEP 3: Try play again after seek
            if (video.paused) {
                Logger.add('[STANDARD:STEP3] Post-seek play attempt');
                try {
                    await video.play();
                } catch (e) {
                    Logger.add('[STANDARD:STEP3_ERROR] Post-seek play failed', {
                        error: e.name,
                        message: e.message
                    });
                    // Don't throw - let ResilienceOrchestrator handle it
                }
            }

            // Log final state
            const duration = (performance.now() - startTime).toFixed(0);
            Logger.add('[STANDARD:EXIT] Recovery attempt complete', {
                duration: duration + 'ms',
                success: !video.paused && video.readyState >= 3,
                state: getState(video)
            });

            // Delayed health check
            setTimeout(() => {
                Logger.add('[STANDARD:DELAYED_CHECK] Post-recovery health', {
                    state: getState(video),
                    isPlaying: !video.paused && video.readyState >= 3
                });
            }, 1500);
        }
    };
})();


