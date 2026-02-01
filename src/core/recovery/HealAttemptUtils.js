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

    const updateHealPointRepeat = (monitorStateRef, point, succeeded) => (
        PlaybackStateStore.updateHealPointRepeat(monitorStateRef, point, succeeded)
    );

    return {
        getBufferEndDelta,
        isAbortError,
        isPlayFailure,
        updateHealPointRepeat
    };
})();
