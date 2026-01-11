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

    const create = (video, options = {}) => {
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});
        const onRemoved = options.onRemoved || (() => {});
        const onReset = options.onReset || (() => {});
        const videoId = options.videoId || 'unknown';

        const logDebug = (message, detail) => {
            if (CONFIG.debug) {
                Logger.add(message, {
                    videoId,
                    ...detail
                });
            }
        };

        const tracker = PlaybackStateTracker.create(video, videoId, logDebug);
        const state = tracker.state;

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

        const handlers = {
            timeupdate: () => {
                tracker.updateProgress('timeupdate');
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
                tracker.markStallEvent('waiting');
                logDebug(`${LOG.EVENT} waiting`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'waiting');
                }
            },
            stalled: () => {
                tracker.markStallEvent('stalled');
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
                tracker.handleReset('abort', onReset);
            },
            emptied: () => {
                state.pauseFromStall = false;
                logDebug(`${LOG.EVENT} emptied`, {
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
                tracker.handleReset('emptied', onReset);
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

                if (tracker.shouldSkipUntilProgress()) {
                    return;
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
