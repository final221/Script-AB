// --- HealAttemptUtils ---
/**
 * Shared helper functions for heal attempts.
 */
const HealAttemptUtils = (() => {
    const getBufferEndDelta = (video) => {
        const ranges = BufferGapFinder.getBufferRanges(video);
        if (!ranges.length) return null;
        const end = ranges[ranges.length - 1].end;
        return end - video.currentTime;
    };

    const isAbortError = (result) => (
        result?.errorName === 'AbortError'
        || (typeof result?.error === 'string' && result.error.includes('aborted'))
    );

    const isPlayFailure = (result) => (
        isAbortError(result)
        || result?.errorName === 'PLAY_STUCK'
    );

    const updateHealPointRepeat = (monitorStateRef, point, succeeded) => {
        if (!monitorStateRef) return 0;
        if (succeeded || !point) {
            monitorStateRef.lastHealPointKey = null;
            monitorStateRef.healPointRepeatCount = 0;
            return 0;
        }
        const key = `${point.start.toFixed(2)}-${point.end.toFixed(2)}`;
        if (monitorStateRef.lastHealPointKey === key) {
            monitorStateRef.healPointRepeatCount = (monitorStateRef.healPointRepeatCount || 0) + 1;
        } else {
            monitorStateRef.lastHealPointKey = key;
            monitorStateRef.healPointRepeatCount = 1;
        }
        return monitorStateRef.healPointRepeatCount;
    };

    return {
        getBufferEndDelta,
        isAbortError,
        isPlayFailure,
        updateHealPointRepeat
    };
})();
