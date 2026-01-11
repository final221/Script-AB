// --- PlaybackMonitor ---
/**
 * Tracks playback progress using media events plus a watchdog interval.
 * Emits stall detection callbacks while keeping event/state logging centralized.
 */
const PlaybackMonitor = (() => {
    const LOG = {
        STATE: '[HEALER:STATE]',
        EVENT: '[HEALER:EVENT]',
        WATCHDOG: '[HEALER:WATCHDOG]'
    };
    const PROGRESS_EPSILON = 0.05;

    const create = (video, options = {}) => {
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});
        const onRemoved = options.onRemoved || (() => {});
        const onReset = options.onReset || (() => {});
        const videoId = options.videoId || 'unknown';

        const state = {
            lastProgressTime: 0,
            lastTime: video.currentTime,
            progressStartTime: null,
            progressStreakMs: 0,
            progressEligible: false,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0,
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
            lastStallEventTime: 0,
            pauseFromStall: false
        };

        const logDebug = (message, detail) => {
            if (CONFIG.debug) {
                Logger.add(message, {
                    videoId,
                    ...detail
                });
            }
        };

        const setState = (nextState, reason) => {
            if (state.state === nextState) return;
            const prevState = state.state;
            state.state = nextState;
            logDebug(LOG.STATE, {
                from: prevState,
                to: nextState,
                reason,
                pauseFromStall: state.pauseFromStall,
                progressStreakMs: state.progressStreakMs,
                progressEligible: state.progressEligible,
                lastProgressAgoMs: state.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                videoState: VideoState.get(video, videoId)
            });
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

        const handleReset = (reason) => {
            const vs = VideoState.get(video, videoId);
            if (vs.currentSrc || vs.src || vs.readyState !== 0) {
                return;
            }

            setState('RESET', reason);
            logDebug('[HEALER:RESET] Video reset', {
                reason,
                videoState: vs
            });
            onReset({ reason, videoState: vs }, state);
        };

        const handlers = {
            timeupdate: () => {
                updateProgress('timeupdate');
                if (state.state !== 'PLAYING') {
                    logDebug(`${LOG.EVENT} timeupdate`, {
                        state: state.state,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                if (!video.paused && state.state !== 'HEALING') {
                    setState('PLAYING', 'timeupdate');
                }
            },
            playing: () => {
                state.pauseFromStall = false;
                state.lastTime = video.currentTime;
                logDebug(`${LOG.EVENT} playing`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (state.state !== 'HEALING') {
                    setState('PLAYING', 'playing');
                }
            },
            waiting: () => {
                markStallEvent('waiting');
                logDebug(`${LOG.EVENT} waiting`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'waiting');
                }
            },
            stalled: () => {
                markStallEvent('stalled');
                logDebug(`${LOG.EVENT} stalled`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'stalled');
                }
            },
            pause: () => {
                logDebug(`${LOG.EVENT} pause`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                setState('PAUSED', 'pause');
            },
            ended: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} ended`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                setState('ENDED', 'ended');
            },
            error: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} error`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                setState('ERROR', 'error');
            },
            abort: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} abort`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                setState('PAUSED', 'abort');
                handleReset('abort');
            },
            emptied: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} emptied`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                handleReset('emptied');
            },
            suspend: () => {
                logDebug(`${LOG.EVENT} suspend`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
            }
        };

        let intervalId;

        const start = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor started', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            Object.entries(handlers).forEach(([event, handler]) => {
                video.addEventListener(event, handler);
            });

            intervalId = setInterval(() => {
                const now = Date.now();
                if (!document.contains(video)) {
                    Logger.add('[HEALER:CLEANUP] Video removed from DOM', {
                        videoId
                    });
                    onRemoved();
                    return;
                }

                if (isHealing()) {
                    return;
                }

                const pausedAfterStall = state.lastStallEventTime > 0
                    && (now - state.lastStallEventTime) < CONFIG.stall.PAUSED_STALL_GRACE_MS;
                const pauseFromStall = state.pauseFromStall || pausedAfterStall;
                if (video.paused && !pauseFromStall) {
                    setState('PAUSED', 'watchdog_paused');
                    return;
                }
                if (video.paused && pauseFromStall && state.state !== 'STALLED') {
                    setState('STALLED', 'paused_after_stall');
                }

                const currentSrc = video.currentSrc || video.getAttribute('src') || '';
                if (currentSrc !== state.lastSrc) {
                    logDebug('[HEALER:SRC] Source changed', {
                        previous: state.lastSrc,
                        current: currentSrc,
                        videoState: VideoState.get(video, videoId)
                    });
                    state.lastSrc = currentSrc;
                }

                const stalledForMs = now - state.lastProgressTime;
                if (stalledForMs < CONFIG.stall.STALL_CONFIRM_MS) {
                    return;
                }

                const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
                const confirmMs = bufferExhausted
                    ? CONFIG.stall.STALL_CONFIRM_MS
                    : CONFIG.stall.STALL_CONFIRM_MS + CONFIG.stall.STALL_CONFIRM_BUFFER_OK_MS;

                if (stalledForMs < confirmMs) {
                    return;
                }

                if (state.state !== 'STALLED') {
                    setState('STALLED', 'watchdog_no_progress');
                }

                if (now - state.lastWatchdogLogTime > 5000) {
                    state.lastWatchdogLogTime = now;
                    logDebug(`${LOG.WATCHDOG} No progress observed`, {
                        stalledForMs,
                        bufferExhausted,
                        state: state.state,
                        videoState: VideoState.get(video, videoId)
                    });
                }

                onStall({
                    trigger: 'WATCHDOG',
                    stalledFor: stalledForMs + 'ms',
                    bufferExhausted,
                    paused: video.paused,
                    pauseFromStall
                }, state);
            }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stop = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor stopped', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            if (intervalId !== undefined) {
                clearInterval(intervalId);
            }

            Object.entries(handlers).forEach(([event, handler]) => {
                video.removeEventListener(event, handler);
            });
        };

        return {
            start,
            stop,
            state
        };
    };

    return { create };
})();
