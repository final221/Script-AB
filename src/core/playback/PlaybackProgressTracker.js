// --- PlaybackProgressTracker ---
/**
 * Tracks progress streaks and candidate eligibility.
 */
const PlaybackProgressTracker = (() => {
    const create = (options = {}) => {
        const state = options.state;
        const logDebugLazy = options.logDebugLazy || (() => {});
        const getCurrentTime = options.getCurrentTime || (() => null);
        const minProgressMs = options.minProgressMs || CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS;

        const updateProgressStreak = (reason, now, progressGapMs) => {
            if (!state.progressStartTime
                || (progressGapMs !== null && progressGapMs > CONFIG.monitoring.PROGRESS_STREAK_RESET_MS)) {
                if (state.progressStartTime) {
                    logDebugLazy(LogEvents.tagged('PROGRESS', 'Progress streak reset'), () => ({
                        reason,
                        progressGapMs,
                        previousStreakMs: state.progressStreakMs,
                        currentTime: getCurrentTime()
                    }));
                }
                state.progressStartTime = now;
                state.progressStreakMs = 0;
                state.progressEligible = false;
            } else {
                state.progressStreakMs = now - state.progressStartTime;
            }

            state.lastProgressTime = now;
            state.pauseFromStall = false;

            if (!state.progressEligible && state.progressStreakMs >= minProgressMs) {
                state.progressEligible = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Candidate eligibility reached'), () => ({
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs,
                    currentTime: getCurrentTime()
                }));
            }

            if (!state.hasProgress) {
                state.hasProgress = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Initial progress observed'), () => ({
                    reason,
                    currentTime: getCurrentTime()
                }));
            }
        };

        return { updateProgressStreak };
    };

    return { create };
})();
