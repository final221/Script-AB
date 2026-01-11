// --- SeekTargetCalculator ---
/**
 * Calculates and validates safe seek targets.
 */
const SeekTargetCalculator = (() => {
    const validateSeekTarget = (video, target) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return { valid: false, reason: 'No buffer' };
        }

        for (let i = 0; i < video.buffered.length; i++) {
            const start = video.buffered.start(i);
            const end = video.buffered.end(i);

            if (target >= start && target <= end) {
                return {
                    valid: true,
                    bufferRange: { start, end },
                    headroom: end - target
                };
            }
        }

        return { valid: false, reason: 'Target not in buffer' };
    };

    const calculateSafeTarget = (healPoint) => {
        const { start, end } = healPoint;
        const bufferSize = end - start;

        if (bufferSize < 1) {
            return start + (bufferSize * 0.5);
        }

        const offset = Math.min(0.5, bufferSize - 1);
        return start + offset;
    };

    return {
        validateSeekTarget,
        calculateSafeTarget
    };
})();
