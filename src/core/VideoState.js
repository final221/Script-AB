// --- VideoState ---
/**
 * Shared helper for consistent video state logging.
 */
const VideoState = (() => {
    const getLite = (video, id) => {
        if (!video) return { error: 'NO_VIDEO' };
        let bufferedLength = 0;
        try {
            bufferedLength = video.buffered ? video.buffered.length : 0;
        } catch (error) {
            bufferedLength = 0;
        }
        const duration = Number.isFinite(video.duration)
            ? video.duration.toFixed(3)
            : String(video.duration);
        return {
            id,
            currentTime: video.currentTime?.toFixed(3),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            bufferedLength,
            duration,
            ended: video.ended,
            currentSrc: video.currentSrc || '',
            src: video.getAttribute ? (video.getAttribute('src') || '') : '',
            errorCode: video.error ? video.error.code : null
        };
    };

    return {
        get: (video, id) => {
            if (!video) return { error: 'NO_VIDEO' };
            const duration = Number.isFinite(video.duration)
                ? video.duration.toFixed(3)
                : String(video.duration);
            return {
                id,
                currentTime: video.currentTime?.toFixed(3),
                paused: video.paused,
                readyState: video.readyState,
                networkState: video.networkState,
                buffered: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
                duration,
                ended: video.ended,
                currentSrc: video.currentSrc || '',
                src: video.getAttribute ? (video.getAttribute('src') || '') : '',
                errorCode: video.error ? video.error.code : null
            };
        },
        getLite
    };
})();
