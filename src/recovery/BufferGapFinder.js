// --- BufferGapFinder ---
/**
 * Finds "heal points" in the video buffer after a stall.
 * When uBO blocks ad segments, new content arrives in a separate buffer range.
 * This module finds that new range so we can seek to it.
 */
const BufferGapFinder = (() => {
    // Minimum buffer size to consider a valid heal point (seconds)
    const MIN_HEAL_BUFFER_S = 2;

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
        if (!ranges || ranges.length === 0) return 'none';
        return ranges.map(r => `[${r.start.toFixed(2)}-${r.end.toFixed(2)}]`).join(', ');
    };

    /**
     * Find a heal point - a buffer range that starts AFTER currentTime
     * with sufficient buffer to be useful.
     * 
     * @param {HTMLVideoElement} video
     * @param {Object} options
     * @param {boolean} options.silent - If true, suppress logging (for polling loops)
     * @returns {{ start: number, end: number, gapSize: number } | null}
     */
    const findHealPoint = (video, options = {}) => {
        if (!video) {
            if (!options.silent) {
                Logger.add('[HEALER:ERROR] No video element');
            }
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = getBufferRanges(video);

        if (!options.silent) {
            Logger.add('[HEALER:SCAN] Scanning for heal point', {
                currentTime: currentTime.toFixed(3),
                bufferRanges: formatRanges(ranges),
                rangeCount: ranges.length
            });
        }

        // Look for a buffer range that starts ahead of current position
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const bufferSize = range.end - range.start;

            // Found a range starting after current position (with small gap tolerance)
            if (range.start > currentTime + 0.5) {
                // Check minimum buffer size
                if (bufferSize < MIN_HEAL_BUFFER_S) {
                    if (!options.silent) {
                        Logger.add('[HEALER:SKIP] Buffer too small', {
                            range: `${range.start.toFixed(2)}-${range.end.toFixed(2)}`,
                            size: bufferSize.toFixed(2) + 's',
                            required: MIN_HEAL_BUFFER_S + 's'
                        });
                    }
                    continue; // Keep looking for a larger buffer
                }

                const healPoint = {
                    start: range.start,
                    end: range.end,
                    gapSize: range.start - currentTime
                };

                if (!options.silent) {
                    Logger.add('[HEALER:FOUND] Heal point identified', {
                        healPoint: `${range.start.toFixed(3)}-${range.end.toFixed(3)}`,
                        gapSize: healPoint.gapSize.toFixed(2) + 's',
                        bufferSize: bufferSize.toFixed(2) + 's'
                    });
                }

                return healPoint;
            }
        }

        if (!options.silent) {
            Logger.add('[HEALER:NONE] No valid heal point found', {
                currentTime: currentTime.toFixed(3),
                ranges: formatRanges(ranges),
                minRequired: MIN_HEAL_BUFFER_S + 's'
            });
        }

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

                return exhausted;
            }
        }

        // Not in any buffer range - we've fallen off
        return true;
    };

    return {
        findHealPoint,
        isBufferExhausted,
        getBufferRanges,
        formatRanges,
        MIN_HEAL_BUFFER_S
    };
})();
