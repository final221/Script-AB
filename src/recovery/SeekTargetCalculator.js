// --- SeekTargetCalculator ---
/**
 * Calculates and validates safe seek targets.
 */
const SeekTargetCalculator = (() => {
    const validateSeekTarget = (video, target) => {
        if (!video?.buffered || video.buffered.length === 0) {
            return { valid: false, reason: 'No buffer' };
        }

        const buffered = video.buffered;
        const length = buffered.length;
        for (let i = 0; i < length; i++) {
            if (i >= buffered.length) break;
            let start;
            let end;
            try {
                start = buffered.start(i);
                end = buffered.end(i);
            } catch (error) {
                return { valid: false, reason: 'Buffer read failed' };
            }

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
        const edgeGuard = CONFIG.recovery.HEAL_EDGE_GUARD_S;

        if (bufferSize < 1) {
            const target = start + (bufferSize * 0.5);
            return Math.min(target, Math.max(start, end - edgeGuard));
        }

        const offset = Math.min(0.5, bufferSize - 1);
        const target = start + offset;
        return Math.min(target, Math.max(start, end - edgeGuard));
    };

    return {
        validateSeekTarget,
        calculateSafeTarget
    };
})();
