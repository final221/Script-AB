// --- MediaState ---
/**
 * Unified helpers for video state + buffer info.
 */
const MediaState = (() => {
    const full = (video, id) => VideoState.get(video, id);
    const lite = (video, id) => VideoState.getLite(video, id);
    const ranges = (video) => BufferGapFinder.getBufferRanges(video);
    const formattedRanges = (video) => BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video));
    const bufferAhead = (video) => BufferGapFinder.getBufferAhead(video);
    const isBufferExhausted = (video) => BufferGapFinder.isBufferExhausted(video);

    return {
        full,
        lite,
        ranges,
        formattedRanges,
        bufferAhead,
        isBufferExhausted
    };
})();
