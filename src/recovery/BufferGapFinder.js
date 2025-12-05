// --- BufferGapFinder ---
/**
 * Finds "heal points" in the video buffer after a stall.
 * When uBO blocks ad segments, new content arrives in a separate buffer range.
 * This module finds that new range so we can seek to it.
 */
const BufferGapFinder = (() => {
    /**
     * Get all buffer ranges as an array of {start, end} objects
     */
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

    /**
     * Format buffer ranges for logging
     */
    const formatRanges = (ranges) => {
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    /**
     * Find a heal point - a buffer range that starts AFTER currentTime
     * This is where new content is buffering after a gap
     * 
     * @param {HTMLVideoElement} video
     * @returns {{ start: number, end: number } | null}
     */
    const findHealPoint = (video) => {
        if (!video) {
            Logger.add('[HEALER:ERROR] No video element');
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = getBufferRanges(video);

        Logger.add('[HEALER:SCAN] Scanning for heal point', {
            currentTime: currentTime.toFixed(3),
            bufferRanges: formatRanges(ranges),
            rangeCount: ranges.length
        });

        // Look for a buffer range that starts ahead of current position
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];

            // Found a range starting after current position (with small gap tolerance)
            if (range.start > currentTime + 0.5) {
                const healPoint = {
                    start: range.start,
                    end: range.end,
                    gapSize: range.start - currentTime
                };

                Logger.add('[HEALER:FOUND] Heal point identified', {
                    healPoint: `${range.start.toFixed(3)}-${range.end.toFixed(3)}`,
                    gapSize: healPoint.gapSize.toFixed(2) + 's',
                    bufferSize: (range.end - range.start).toFixed(2) + 's'
                });

                return healPoint;
            }
        }

        Logger.add('[HEALER:NONE] No heal point found yet', {
            currentTime: currentTime.toFixed(3),
            ranges: formatRanges(ranges)
        });

        return null;
    };

    /**
     * Check if we're at buffer exhaustion (stalled because buffer ran out)
     */
    const isBufferExhausted = (video) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return true; // No buffer at all
        }

        const currentTime = video.currentTime;

        // Find which buffer range contains currentTime
        for (let i = 0; i < video.buffered.length; i++) {
            const start = video.buffered.start(i);
            const end = video.buffered.end(i);

            if (currentTime >= start && currentTime <= end) {
                // We're in this range - check if we're at the edge
                const bufferRemaining = end - currentTime;
                const exhausted = bufferRemaining < 0.5; // Less than 0.5s remaining

                if (exhausted) {
                    Logger.add('[HEALER:EXHAUSTED] Buffer exhausted', {
                        currentTime: currentTime.toFixed(3),
                        bufferEnd: end.toFixed(3),
                        remaining: bufferRemaining.toFixed(3) + 's'
                    });
                }

                return exhausted;
            }
        }

        // Not in any buffer range - we've fallen off
        Logger.add('[HEALER:GAP] Current time not in any buffer range', {
            currentTime: currentTime.toFixed(3)
        });
        return true;
    };

    return {
        findHealPoint,
        isBufferExhausted,
        getBufferRanges,
        formatRanges
    };
})();
