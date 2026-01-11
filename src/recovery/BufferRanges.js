// --- BufferRanges ---
/**
 * Helpers for working with media buffer ranges.
 */
const BufferRanges = (() => {
    const getBufferRanges = (video) => {
        const ranges = [];
        if (!video?.buffered) return ranges;

        for (let i = 0; i < video.buffered.length; i++) {
            ranges.push({
                start: video.buffered.start(i),
                end: video.buffered.end(i)
            });
        }
        return ranges;
    };

    const formatRanges = (ranges) => {
        if (!ranges || ranges.length === 0) return 'none';
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    const isBufferExhausted = (video) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return true;
        }

        const currentTime = video.currentTime;

        for (let i = 0; i < video.buffered.length; i++) {
            const start = video.buffered.start(i);
            const end = video.buffered.end(i);

            if (currentTime >= start && currentTime <= end) {
                const bufferRemaining = end - currentTime;
                return bufferRemaining < 0.5;
            }
        }

        return true;
    };

    return {
        getBufferRanges,
        formatRanges,
        isBufferExhausted
    };
})();
