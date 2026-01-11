// --- VideoState ---
/**
 * Shared helper for consistent video state logging.
 */
const VideoState = (() => {
    return {
        get: (video) => {
            if (!video) return { error: 'NO_VIDEO' };
            return {
                currentTime: video.currentTime?.toFixed(3),
                paused: video.paused,
                readyState: video.readyState,
                networkState: video.networkState,
                buffered: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
            };
        }
    };
})();
