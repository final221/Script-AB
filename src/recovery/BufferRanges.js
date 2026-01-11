// --- BufferRanges ---
/**
 * Helpers for working with media buffer ranges.
 */
const BufferRanges = (() => {
    const getBufferRanges = (video) => {
        const ranges = [];
        const buffered = video?.buffered;
        if (!buffered) return ranges;

        const length = buffered.length;
        for (let i = 0; i < length; i++) {
            if (i >= buffered.length) break;
            try {
                ranges.push({
                    start: buffered.start(i),
                    end: buffered.end(i)
                });
            } catch (error) {
                Logger.add('[HEALER:BUFFER_ERROR] Buffer ranges changed during read', {
                    error: error?.name,
                    message: error?.message,
                    index: i,
                    length: buffered.length
                });
                break;
            }
        }
        return ranges;
    };

    const formatRanges = (ranges) => {
        if (!ranges || ranges.length === 0) return 'none';
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    const isBufferExhausted = (video) => {
        const buffered = video?.buffered;
        if (!buffered || buffered.length === 0) {
            return true;
        }

        const currentTime = video.currentTime;

        const length = buffered.length;
        for (let i = 0; i < length; i++) {
            if (i >= buffered.length) break;
            let start;
            let end;
            try {
                start = buffered.start(i);
                end = buffered.end(i);
            } catch (error) {
                Logger.add('[HEALER:BUFFER_ERROR] Buffer exhaustion check failed', {
                    error: error?.name,
                    message: error?.message,
                    index: i,
                    length: buffered.length
                });
                return true;
            }

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
