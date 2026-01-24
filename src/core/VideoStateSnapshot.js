// --- VideoStateSnapshot ---
/**
 * Standardized helpers for capturing video state snapshots for logs.
 */
const VideoStateSnapshot = (() => {
    const getBufferedEnd = (video) => {
        if (!video) return 'empty';
        try {
            if (video.buffered?.length > 0) {
                return `${video.buffered.end(video.buffered.length - 1).toFixed(2)}`;
            }
            return 'empty';
        } catch (error) {
            return 'unavailable';
        }
    };

    const full = (video, id, options = {}) => {
        const compactSrc = options.compactSrc !== false;
        return compactSrc
            ? VideoState.getLog(video, id)
            : VideoState.get(video, id);
    };

    const lite = (video, id, options = {}) => {
        const compactSrc = options.compactSrc !== false;
        return compactSrc
            ? VideoState.getLiteLog(video, id)
            : VideoState.getLite(video, id);
    };

    const forLog = (video, id, mode = 'full') => (
        mode === 'lite' ? lite(video, id) : full(video, id)
    );

    const summarize = (video) => {
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };
        const base = VideoState.getLite(video, null);
        return {
            currentTime: base.currentTime,
            paused: base.paused,
            readyState: base.readyState,
            networkState: base.networkState,
            buffered: getBufferedEnd(video),
            error: base.errorCode
        };
    };

    return {
        full,
        lite,
        forLog,
        summarize
    };
})();
