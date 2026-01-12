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
            firstSeenTime: Date.now(),
            firstReadyTime: 0,
            initialProgressTimeoutLogged: false,
            noHealPointCount: 0,
            nextHealAllowedTime: 0,
            lastBackoffLogTime: 0,
            initLogEmitted: false,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0,
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
            lastSrcAttr: video.getAttribute ? (video.getAttribute('src') || '') : '',
            lastReadyState: video.readyState,
            lastNetworkState: video.networkState,
            lastBufferedLength: (() => {
                try {
                    return video.buffered ? video.buffered.length : 0;
                } catch (error) {
                    return 0;
                }
            })(),
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

        const markReady = (reason) => {
            if (state.firstReadyTime) return;
            const src = video.currentSrc || video.getAttribute('src') || '';
            if (!src && video.readyState < 1) {
                return;
            }
            state.firstReadyTime = Date.now();
            logDebug('[HEALER:READY] Initial ready state observed', {
                reason,
                readyState: video.readyState,
                currentSrc: src
            });
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
                const now = Date.now();
                markReady('watchdog_ready_check');
                const graceMs = CONFIG.stall.INIT_PROGRESS_GRACE_MS || CONFIG.stall.STALL_CONFIRM_MS;
                const baselineTime = state.firstReadyTime || state.firstSeenTime;
                const waitingForProgress = (now - baselineTime) < graceMs;

                if (waitingForProgress) {
                    if (!state.initLogEmitted) {
                        state.initLogEmitted = true;
                        logDebug('[HEALER:WATCHDOG] Awaiting initial progress', {
                            state: state.state,
                            graceMs,
                            baseline: state.firstReadyTime ? 'ready' : 'seen',
                            videoState: VideoState.get(video, videoId)
                        });
                    }
                    return true;
                }

                if (!state.initialProgressTimeoutLogged) {
                    state.initialProgressTimeoutLogged = true;
                    logDebug('[HEALER:WATCHDOG] Initial progress timeout', {
                        state: state.state,
                        waitedMs: now - baselineTime,
                        graceMs,
                        baseline: state.firstReadyTime ? 'ready' : 'seen',
                        videoState: VideoState.get(video, videoId)
                    });
                }

                return false;
            }
            return false;
        };

        return {
            state,
            updateProgress,
            markStallEvent,
            markReady,
            handleReset,
            shouldSkipUntilProgress
        };
    };

    return { create };
})();
