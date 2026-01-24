// --- PlaybackProgressReset ---
/**
 * Clears backoff/reset flags when progress resumes.
 */
const PlaybackProgressReset = (() => {
    const create = (options = {}) => {
        const state = options.state;
        const logDebugLazy = options.logDebugLazy || (() => {});

        const clearBackoffOnProgress = (reason, now) => {
            if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
                logDebugLazy(LogEvents.tagged('BACKOFF', 'Cleared after progress'), () => ({
                    reason,
                    previousNoHealPoints: state.noHealPointCount,
                    previousNextHealAllowedMs: state.nextHealAllowedTime
                        ? (state.nextHealAllowedTime - now)
                        : 0
                }));
                state.noHealPointCount = 0;
                state.nextHealAllowedTime = 0;
                state.noHealPointRefreshUntil = 0;
            }
        };

        const clearPlayBackoffOnProgress = (reason, now) => {
            if (state.playErrorCount > 0 || state.nextPlayHealAllowedTime > 0 || state.healPointRepeatCount > 0) {
                logDebugLazy(LogEvents.tagged('PLAY_BACKOFF', 'Cleared after progress'), () => ({
                    reason,
                    previousPlayErrors: state.playErrorCount,
                    previousNextPlayAllowedMs: state.nextPlayHealAllowedTime
                        ? (state.nextPlayHealAllowedTime - now)
                        : 0,
                    previousHealPointRepeats: state.healPointRepeatCount
                }));
                state.playErrorCount = 0;
                state.nextPlayHealAllowedTime = 0;
                state.lastPlayErrorTime = 0;
                state.lastPlayBackoffLogTime = 0;
                state.lastHealPointKey = null;
                state.healPointRepeatCount = 0;
            }
        };

        const clearEmergencySwitch = () => {
            if (state.lastEmergencySwitchAt) {
                state.lastEmergencySwitchAt = 0;
            }
        };

        const clearStarveOnProgress = (reason, now) => {
            if (state.bufferStarved || state.bufferStarvedSince) {
                logDebugLazy(LogEvents.tagged('STARVE_CLEAR', 'Buffer starvation cleared by progress'), () => ({
                    reason,
                    bufferStarvedSinceMs: state.bufferStarvedSince
                        ? (now - state.bufferStarvedSince)
                        : null
                }));
                state.bufferStarved = false;
                state.bufferStarvedSince = 0;
                state.bufferStarveUntil = 0;
                state.lastBufferStarveLogTime = 0;
                state.lastBufferStarveSkipLogTime = 0;
            }
        };

        return {
            clearBackoffOnProgress,
            clearPlayBackoffOnProgress,
            clearEmergencySwitch,
            clearStarveOnProgress
        };
    };

    return { create };
})();
