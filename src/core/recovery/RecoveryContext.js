// --- RecoveryContext ---
/**
 * Shared context wrapper for recovery flows.
 */
const RecoveryContext = (() => {
    const buildDecisionContext = (context) => {
        const video = context?.video;
        const monitorState = context?.monitorState;
        const now = Number.isFinite(context?.now) ? context.now : Date.now();
        const videoId = context?.videoId || 'unknown';
        const ranges = video ? MediaState.ranges(video) : [];
        const lastRange = ranges.length ? ranges[ranges.length - 1] : null;
        const currentTime = video && Number.isFinite(video.currentTime) ? video.currentTime : null;
        const bufferEnd = lastRange ? lastRange.end : null;
        const headroom = (bufferEnd !== null && currentTime !== null)
            ? Math.max(0, bufferEnd - currentTime)
            : null;
        const hasSrc = Boolean(video?.currentSrc || video?.getAttribute?.('src'));

        return {
            now,
            videoId,
            ranges,
            bufferEnd,
            headroom,
            hasSrc,
            currentTime,
            readyState: video?.readyState ?? null,
            networkState: video?.networkState ?? null,
            stalledForMs: monitorState?.lastProgressTime
                ? (now - monitorState.lastProgressTime)
                : null
        };
    };

    const create = (video, monitorState, getVideoId, detail = {}) => {
        const videoId = detail.videoId || (typeof getVideoId === 'function'
            ? getVideoId(video)
            : 'unknown');
        const now = Number.isFinite(detail.now) ? detail.now : Date.now();
        return {
            video,
            monitorState,
            videoId,
            now,
            trigger: detail.trigger || null,
            reason: detail.reason || null,
            detail,
            getSnapshot: () => StateSnapshot.full(video, videoId),
            getLiteSnapshot: () => StateSnapshot.lite(video, videoId),
            getLogSnapshot: () => VideoStateSnapshot.forLog(video, videoId),
            getLiteLogSnapshot: () => VideoStateSnapshot.forLog(video, videoId, 'lite'),
            getRanges: () => BufferGapFinder.getBufferRanges(video),
            getRangesFormatted: () => BufferGapFinder.analyze(video).formattedRanges,
            getBufferAhead: () => BufferGapFinder.getBufferAhead(video),
            getDecisionContext: () => buildDecisionContext({
                video,
                monitorState,
                videoId,
                now
            })
        };
    };

    const from = (videoOrContext, monitorState, getVideoId, detail = {}) => {
        if (videoOrContext && typeof videoOrContext === 'object' && videoOrContext.video) {
            return videoOrContext;
        }
        return create(videoOrContext, monitorState, getVideoId, detail);
    };

    return {
        create,
        from,
        buildDecisionContext
    };
})();
