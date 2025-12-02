// --- Frame Drop Detector ---
/**
 * Monitors video frame drops to detect playback quality issues.
 * @responsibility Track dropped frames and trigger recovery on severe drops.
 */
const FrameDropDetector = (() => {
    let state = {
        lastDroppedFrames: 0,
        lastTotalFrames: 0,
        lastCurrentTime: -1,
        lastCheckTimestamp: 0
    };

    const reset = () => {
        state.lastDroppedFrames = 0;
        state.lastTotalFrames = 0;
        state.lastCurrentTime = -1;
        state.lastCheckTimestamp = 0;
    };

    const validatePlaybackProgression = (video) => {
        const now = Date.now();
        const timeSinceLastCheck = now - state.lastCheckTimestamp;

        // First check or reset
        if (state.lastCurrentTime === -1) {
            state.lastCurrentTime = video.currentTime;
            state.lastCheckTimestamp = now;
            return true; // Assume playing until proven otherwise
        }

        const timeAdvanced = video.currentTime - state.lastCurrentTime;
        // Expected advance is 90% of real time to account for minor variances
        const expectedAdvance = (timeSinceLastCheck / 1000) * 0.9;

        // Update state for next check
        state.lastCurrentTime = video.currentTime;
        state.lastCheckTimestamp = now;

        // If time advanced sufficiently, video is playing
        if (timeAdvanced >= expectedAdvance) {
            return true;
        }

        // Allow for seeking or buffering states
        if (video.seeking || video.readyState < 3) {
            return true;
        }

        return false; // Video is actually stuck
    };

    const check = (video) => {
        if (!video || !video.getVideoPlaybackQuality) return null;

        const quality = video.getVideoPlaybackQuality();
        const newDropped = quality.droppedVideoFrames - state.lastDroppedFrames;
        const newTotal = quality.totalVideoFrames - state.lastTotalFrames;

        if (CONFIG.debug) {
            Logger.add('FrameDropDetector[Debug]: Frame check', {
                dropped: quality.droppedVideoFrames,
                total: quality.totalVideoFrames,
                lastDropped: state.lastDroppedFrames,
                lastTotal: state.lastTotalFrames,
                newDropped,
                newTotal,
            });
        }

        if (newDropped > 0) {
            const recentDropRate = newTotal > 0 ? (newDropped / newTotal) * 100 : 0;
            Logger.add('[HEALTH] Frame drop detected', {
                newDropped,
                newTotal,
                recentDropRate: recentDropRate.toFixed(2) + '%'
            });

            const exceedsSevere = newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD;
            const exceedsModerate = newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD &&
                recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD;

            if (exceedsSevere || exceedsModerate) {
                // CRITICAL FIX: Validate video is actually stuck before triggering
                const isActuallyPlaying = validatePlaybackProgression(video);

                if (isActuallyPlaying) {
                    Logger.add('[HEALTH] Frame drops detected but video is playing normally - ignoring', {
                        dropped: newDropped,
                        currentTime: video.currentTime
                    });
                    // Update baseline so we don't re-trigger on these frames
                    state.lastDroppedFrames = quality.droppedVideoFrames;
                    state.lastTotalFrames = quality.totalVideoFrames;
                    return null;
                }

                const severity = exceedsSevere ? 'SEVERE' : 'MODERATE';
                Logger.add(`[HEALTH] Frame drop threshold exceeded | Severity: ${severity}`, {
                    newDropped,
                    threshold: exceedsSevere ? CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD : CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD,
                    recentDropRate
                });

                state.lastDroppedFrames = quality.droppedVideoFrames;
                state.lastTotalFrames = quality.totalVideoFrames;
                return {
                    reason: `${severity} frame drop`,
                    details: { newDropped, newTotal, recentDropRate, severity }
                };
            }
        }

        state.lastDroppedFrames = quality.droppedVideoFrames;
        state.lastTotalFrames = quality.totalVideoFrames;
        return null;
    };

    return {
        reset,
        check
    };
})();
