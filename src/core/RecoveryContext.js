// --- RecoveryContext ---
/**
 * Shared context wrapper for recovery flows.
 */
const RecoveryContext = (() => {
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
            getRanges: () => BufferGapFinder.getBufferRanges(video),
            getRangesFormatted: () => BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
            getBufferAhead: () => BufferGapFinder.getBufferAhead(video)
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
        from
    };
})();
