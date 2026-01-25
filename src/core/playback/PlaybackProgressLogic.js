// --- PlaybackProgressLogic ---
/**
 * Progress, ready, and stall-related tracking helpers.
 */
const PlaybackProgressLogic = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId;
        const state = options.state;
        const logHelper = options.logHelper;
        const logDebugLazy = options.logDebugLazy || (() => {});
        const getCurrentTime = options.getCurrentTime || (() => null);
        const clearResetPending = options.clearResetPending || (() => {});
        const evaluateResetState = options.evaluateResetState || (() => ({}));
        const progressReset = PlaybackProgressReset.create({
            state,
            logDebugLazy,
            getCurrentTime
        });

        const updateProgress = (reason) => {
            const now = Date.now();
            const timeDelta = video.currentTime - state.lastTime;
            const progressGapMs = state.lastProgressTime
                ? now - state.lastProgressTime
                : null;

            state.lastTime = video.currentTime;

            if (video.paused || timeDelta <= 0.05) {
                return;
            }

            if (state.stallStartTime) {
                const stallDurationMs = now - state.stallStartTime;
                state.stallStartTime = 0;
                Metrics.recordStallDuration(stallDurationMs, {
                    videoId,
                    reason,
                    bufferAhead: state.lastBufferAhead
                });
                logDebugLazy(() => logHelper.buildStallDuration(reason, stallDurationMs, state.lastBufferAhead));
            }

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
            if (state.resetPendingAt) {
                clearResetPending('progress');
            }

            if (!state.progressEligible
                && state.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS) {
                state.progressEligible = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Candidate eligibility reached'), () => ({
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
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

            progressReset.clearBackoffOnProgress(reason, now);
            progressReset.clearPlayBackoffOnProgress(reason, now);
            progressReset.clearEmergencySwitch();
            progressReset.clearStarveOnProgress(reason, now);
        };

        const markReady = (reason) => {
            if (state.firstReadyTime) return;
            const src = video.currentSrc || video.getAttribute('src') || '';
            if (!src && video.readyState < 1) {
                return;
            }
            state.firstReadyTime = Date.now();
            logDebugLazy(LogEvents.tagged('READY', 'Initial ready state observed'), () => ({
                reason,
                readyState: video.readyState,
                currentSrc: VideoState.compactSrc(src)
            }));
            if (state.resetPendingAt) {
                const vs = VideoState.get(video, videoId);
                const resetState = evaluateResetState(vs);
                if (!resetState.isHardReset && !resetState.isSoftReset) {
                    clearResetPending('ready', vs);
                }
            }
        };

        const markStallEvent = (reason) => {
            state.lastStallEventTime = Date.now();
            if (!state.stallStartTime) {
                state.stallStartTime = state.lastStallEventTime;
            }
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
                logDebugLazy(LogEvents.tagged('STALL', 'Marked paused due to stall'), () => ({
                    reason,
                    currentTime: getCurrentTime()
                }));
            }
        };

        const shouldSkipUntilProgress = () => {
            if (!state.hasProgress) {
                const now = Date.now();
                markReady('watchdog_ready_check');
                const graceMs = CONFIG.stall.INIT_PROGRESS_GRACE_MS || CONFIG.stall.STALL_CONFIRM_MS;
                const baselineTime = state.firstReadyTime || state.firstSeenTime;
                const waitingForProgress = (now - baselineTime) < graceMs;

                if (waitingForProgress) {
                    if (!state.initLogEmitted) {
                        state.initLogEmitted = true;
                        logDebugLazy(LogEvents.tagged('WATCHDOG', 'Awaiting initial progress'), () => ({
                            state: state.state,
                            graceMs,
                            baseline: state.firstReadyTime ? 'ready' : 'seen'
                        }));
                    }
                    return true;
                }

                if (!state.initialProgressTimeoutLogged) {
                    state.initialProgressTimeoutLogged = true;
                    logDebugLazy(LogEvents.tagged('WATCHDOG', 'Initial progress timeout'), () => ({
                        state: state.state,
                        waitedMs: now - baselineTime,
                        graceMs,
                        baseline: state.firstReadyTime ? 'ready' : 'seen'
                    }));
                }

                return false;
            }
            return false;
        };

        return {
            updateProgress,
            markReady,
            markStallEvent,
            shouldSkipUntilProgress
        };
    };

    return { create };
})();
