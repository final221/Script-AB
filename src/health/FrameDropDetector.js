// --- Frame Drop Detector ---
/**
 * Monitors video frame drops to detect playback quality issues.
 * @responsibility Track dropped frames and trigger recovery on severe drops.
 */
const FrameDropDetector = (() => {
    let state = {
        lastDroppedFrames: 0,
        lastTotalFrames: 0
    };

    const reset = () => {
        state.lastDroppedFrames = 0;
        state.lastTotalFrames = 0;
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
