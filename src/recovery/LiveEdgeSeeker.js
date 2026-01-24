// --- LiveEdgeSeeker ---
/**
 * Seeks to a heal point and resumes playback.
 * CRITICAL: Validates seek target is within buffer bounds to avoid Infinity duration.
 */
const LiveEdgeSeeker = (() => {
    /**
     * Seek to heal point and attempt to resume playback
     * 
     * @param {HTMLVideoElement} video
     * @param {{ start: number, end: number }} healPoint
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    const seekAndPlay = async (video, healPoint) => {
        const startTime = performance.now();
        const fromTime = video.currentTime;

        // Calculate safe target
        const target = SeekTargetCalculator.calculateSafeTarget(healPoint);

        const validation = SeekTargetCalculator.validateSeekTarget(video, target);
        const bufferRanges = BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video));

        Logger.add(LogEvents.tagged('SEEK', 'Attempting seek'), {
            from: fromTime.toFixed(3),
            to: target.toFixed(3),
            healRange: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
            valid: validation.valid,
            headroom: validation.headroom?.toFixed(2),
            bufferRanges
        });

        if (!validation.valid) {
            Logger.add(LogEvents.tagged('SEEK_ABORT', 'Invalid seek target'), {
                target: target.toFixed(3),
                reason: validation.reason,
                bufferRanges
            });
            return { success: false, error: validation.reason, errorName: 'INVALID_TARGET' };
        }

        // Perform seek
        try {
            video.currentTime = target;

            // Brief wait for seek to settle
            await Fn.sleep(CONFIG.recovery.SEEK_SETTLE_MS);

            Logger.add(LogEvents.tagged('SEEKED', 'Seek completed'), {
                newTime: video.currentTime.toFixed(3),
                readyState: video.readyState
            });
        } catch (e) {
            Logger.add(LogEvents.tagged('SEEK_ERROR', 'Seek failed'), {
                error: e.name,
                message: e.message,
                bufferRanges
            });
            return { success: false, error: e.message, errorName: e.name };
        }

        // Attempt playback
        if (video.paused) {
            Logger.add(LogEvents.tagged('PLAY', 'Attempting play'));
            try {
                await video.play();

                // Verify playback started
                await Fn.sleep(CONFIG.recovery.PLAYBACK_VERIFY_MS);

                if (!video.paused && video.readyState >= 3) {
                    const duration = (performance.now() - startTime).toFixed(0);
                    Logger.add(LogEvents.tagged('SUCCESS', 'Playback resumed'), {
                        duration: duration + 'ms',
                        currentTime: video.currentTime.toFixed(3),
                        readyState: video.readyState
                    });
                    return { success: true };
                } else {
                    Logger.add(LogEvents.tagged('PLAY_STUCK', 'Play returned but not playing'), {
                        paused: video.paused,
                        readyState: video.readyState,
                        networkState: video.networkState,
                        currentSrc: video.currentSrc || '',
                        bufferRanges
                    });
                    return { success: false, error: 'Play did not resume', errorName: 'PLAY_STUCK' };
                }
            } catch (e) {
                Logger.add(LogEvents.tagged('PLAY_ERROR', 'Play failed'), {
                    error: e.name,
                    message: e.message,
                    networkState: video.networkState,
                    readyState: video.readyState,
                    currentSrc: video.currentSrc || '',
                    bufferRanges
                });
                return { success: false, error: e.message, errorName: e.name };
            }
        } else {
            // Video already playing
            Logger.add(LogEvents.tagged('ALREADY_PLAYING', 'Video resumed on its own'));
            return { success: true };
        }
    };

    return {
        seekAndPlay,
        validateSeekTarget: SeekTargetCalculator.validateSeekTarget,
        calculateSafeTarget: SeekTargetCalculator.calculateSafeTarget
    };
})();
