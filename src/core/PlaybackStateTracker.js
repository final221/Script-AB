// --- PlaybackStateTracker ---
/**
 * Shared playback state tracking for PlaybackMonitor.
 */
const PlaybackStateTracker = (() => {
    const PROGRESS_EPSILON = 0.05;

    const create = (video, videoId, logDebug) => {
        const state = {
            lastProgressTime: 0,
            lastTime: video.currentTime,
            progressStartTime: null,
            progressStreakMs: 0,
            progressEligible: false,
            hasProgress: false,
            noHealPointCount: 0,
            nextHealAllowedTime: 0,
            lastBackoffLogTime: 0,
            initLogEmitted: false,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0,
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
            lastStallEventTime: 0,
            pauseFromStall: false
        };

        const updateProgress = (reason) => {
            const now = Date.now();
            const timeDelta = video.currentTime - state.lastTime;
            const progressGapMs = state.lastProgressTime
                ? now - state.lastProgressTime
                : null;

            state.lastTime = video.currentTime;

            if (video.paused || timeDelta <= PROGRESS_EPSILON) {
                return;
            }

            if (!state.progressStartTime
                || (progressGapMs !== null && progressGapMs > CONFIG.monitoring.PROGRESS_STREAK_RESET_MS)) {
                if (state.progressStartTime) {
                    logDebug('[HEALER:PROGRESS] Progress streak reset', {
                        reason,
                        progressGapMs,
                        previousStreakMs: state.progressStreakMs,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                state.progressStartTime = now;
                state.progressStreakMs = 0;
                state.progressEligible = false;
            } else {
                state.progressStreakMs = now - state.progressStartTime;
            }

            state.lastProgressTime = now;
            state.pauseFromStall = false;

            if (!state.progressEligible
                && state.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS) {
                state.progressEligible = true;
                logDebug('[HEALER:PROGRESS] Candidate eligibility reached', {
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                    videoState: VideoState.get(video, videoId)
                });
            }

            if (!state.hasProgress) {
                state.hasProgress = true;
                logDebug('[HEALER:PROGRESS] Initial progress observed', {
                    reason,
                    videoState: VideoState.get(video, videoId)
                });
            }

            if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
                logDebug('[HEALER:BACKOFF] Cleared after progress', {
                    reason,
                    previousNoHealPoints: state.noHealPointCount,
                    previousNextHealAllowedMs: state.nextHealAllowedTime
                        ? (state.nextHealAllowedTime - now)
                        : 0
                });
                state.noHealPointCount = 0;
                state.nextHealAllowedTime = 0;
            }
        };

        const markStallEvent = (reason) => {
            state.lastStallEventTime = Date.now();
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
                logDebug('[HEALER:STALL] Marked paused due to stall', {
                    reason,
                    videoState: VideoState.get(video, videoId)
                });
            }
        };

        const handleReset = (reason, onReset) => {
            const vs = VideoState.get(video, videoId);
            const ranges = BufferGapFinder.getBufferRanges(video);
            const hasBuffer = ranges.length > 0;
            const hasSrc = Boolean(vs.currentSrc || vs.src);
            const lowReadyState = vs.readyState <= 1;
            const isHardReset = !hasSrc && lowReadyState;
            const isSoftReset = lowReadyState
                && !hasBuffer
                && (vs.networkState === 0 || vs.networkState === 3);

            logDebug('[HEALER:RESET_CHECK] Reset evaluation', {
                reason,
                hasSrc,
                readyState: vs.readyState,
                networkState: vs.networkState,
                bufferRanges: BufferGapFinder.formatRanges(ranges),
                lastSrc: state.lastSrc,
                hardReset: isHardReset,
                softReset: isSoftReset
            });

            if (!isHardReset && !isSoftReset) {
                logDebug('[HEALER:RESET_SKIP] Reset suppressed', {
                    reason,
                    hasSrc,
                    readyState: vs.readyState,
                    networkState: vs.networkState,
                    hasBuffer
                });
                return;
            }

            state.state = 'RESET';
            logDebug('[HEALER:RESET] Video reset', {
                reason,
                resetType: isHardReset ? 'hard' : 'soft',
                videoState: vs
            });
            onReset({ reason, videoState: vs }, state);
        };

        const shouldSkipUntilProgress = () => {
            if (!state.hasProgress) {
                if (!state.initLogEmitted) {
                    state.initLogEmitted = true;
                    logDebug('[HEALER:WATCHDOG] Awaiting initial progress', {
                        state: state.state,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                return true;
            }
            return false;
        };

        return {
            state,
            updateProgress,
            markStallEvent,
            handleReset,
            shouldSkipUntilProgress
        };
    };

    return { create };
})();
