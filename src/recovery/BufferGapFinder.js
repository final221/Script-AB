// --- BufferGapFinder ---
/**
 * Finds "heal points" in the video buffer after a stall.
 * When uBO blocks ad segments, new content arrives in a separate buffer range.
 * This module finds that new range so we can seek to it.
 */
const BufferGapFinder = (() => {
    const analyze = (video, options = {}) => {
        const ranges = BufferRanges.getBufferRanges(video);
        const formattedRanges = BufferRanges.formatRanges(ranges);
        const bufferAhead = BufferRanges.getBufferAhead(video);
        const bufferExhausted = BufferRanges.isBufferExhausted(video);
        const includeHealPoint = options.includeHealPoint === true;
        const healPoint = includeHealPoint
            ? HealPointFinder.findHealPoint(video, { silent: true })
            : null;
        return {
            ranges,
            formattedRanges,
            bufferAhead,
            bufferExhausted,
            healPoint
        };
    };

    return {
        analyze,
        findHealPoint: HealPointFinder.findHealPoint,
        isBufferExhausted: BufferRanges.isBufferExhausted,
        getBufferRanges: BufferRanges.getBufferRanges,
        getBufferAhead: BufferRanges.getBufferAhead,
        formatRanges: BufferRanges.formatRanges,
        MIN_HEAL_BUFFER_S: HealPointFinder.MIN_HEAL_BUFFER_S
    };
})();
