// --- HealPointFinder ---
/**
 * Finds heal points in buffered ranges.
 */
const HealPointFinder = (() => {
    const MIN_HEAL_BUFFER_S = 2;

    const findHealPoint = (video, options = {}) => {
        if (!video) {
            if (!options.silent) {
                Logger.add('[HEALER:ERROR] No video element');
            }
            return null;
        }

        const currentTime = video.currentTime;
        const ranges = BufferRanges.getBufferRanges(video);

        if (!options.silent) {
            Logger.add('[HEALER:SCAN] Scanning for heal point', {
                currentTime: currentTime.toFixed(3),
                bufferRanges: BufferRanges.formatRanges(ranges),
                rangeCount: ranges.length
            });
        }

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const effectiveStart = Math.max(range.start, currentTime);
            const contentAhead = range.end - effectiveStart;

            if (contentAhead > MIN_HEAL_BUFFER_S) {
                let healStart = range.start;
                let isNudge = false;

                if (range.start <= currentTime) {
                    healStart = currentTime + 0.5;
                    isNudge = true;

                    if (healStart >= range.end - 0.1) {
                        if (!options.silent) {
                            Logger.add('[HEALER:SKIP] Nudge target too close to buffer end');
                        }
                        continue;
                    }
                }

                const healPoint = {
                    start: healStart,
                    end: range.end,
                    gapSize: healStart - currentTime,
                    isNudge: isNudge
                };

                if (!options.silent) {
                    Logger.add(isNudge ? '[HEALER:NUDGE] Contiguous buffer found' : '[HEALER:FOUND] Heal point identified', {
                        healPoint: `${healStart.toFixed(3)}-${range.end.toFixed(3)}`,
                        gapSize: healPoint.gapSize.toFixed(2) + 's',
                        bufferAhead: contentAhead.toFixed(2) + 's'
                    });
                }

                return healPoint;
            }
        }

        if (!options.silent) {
            Logger.add('[HEALER:NONE] No valid heal point found', {
                currentTime: currentTime.toFixed(3),
                ranges: BufferRanges.formatRanges(ranges),
                minRequired: MIN_HEAL_BUFFER_S + 's'
            });
        }

        return null;
    };

    return {
        findHealPoint,
        MIN_HEAL_BUFFER_S
    };
})();
