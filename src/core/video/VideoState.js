// --- VideoState ---
/**
 * Shared helper for consistent video state logging.
 */
const VideoState = (() => {
    const compactSrc = (src) => {
        if (!src) return '';
        const blobPrefix = 'blob:https://www.twitch.tv/';
        if (src.startsWith(blobPrefix)) {
            const id = src.slice(blobPrefix.length);
            const shortId = id.length > 10
                ? `${id.slice(0, 4)}...${id.slice(-4)}`
                : id;
            return `blob:twitch#${shortId}`;
        }
        if (src.startsWith('blob:')) {
            const id = src.slice('blob:'.length);
            const shortId = id.length > 12
                ? `${id.slice(0, 5)}...${id.slice(-5)}`
                : id;
            return `blob#${shortId}`;
        }
        const maxLen = CONFIG?.logging?.LOG_URL_MAX_LEN || 80;
        if (src.length > maxLen) {
            return src.slice(0, Math.max(maxLen - 3, 0)) + '...';
        }
        return src;
    };

    const withCompactSrc = (snapshot) => {
        if (!snapshot || snapshot.error) return snapshot;
        return {
            ...snapshot,
            currentSrc: compactSrc(snapshot.currentSrc || ''),
            src: compactSrc(snapshot.src || '')
        };
    };

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

    const getFull = (video, id) => {
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
    };

    return {
        get: getFull,
        getLite,
        getLog: (video, id) => withCompactSrc(getFull(video, id)),
        getLiteLog: (video, id) => withCompactSrc(getLite(video, id)),
        compactSrc
    };
})();
