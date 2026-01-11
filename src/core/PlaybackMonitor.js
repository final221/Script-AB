// --- PlaybackMonitor ---
/**
 * Tracks playback progress using media events plus a watchdog interval.
 * Emits stall detection callbacks while keeping event/state logging centralized.
 */
const PlaybackMonitor = (() => {
    const getVideoState = (video) => {
        if (!video) return { error: 'NO_VIDEO' };
        return {
            currentTime: video.currentTime?.toFixed(3),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
        };
    };

    const create = (video, options = {}) => {
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});
        const onRemoved = options.onRemoved || (() => {});

        const state = {
            lastProgressTime: Date.now(),
            lastTime: video.currentTime,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0
        };

        const setState = (nextState, reason) => {
            if (state.state === nextState) return;
            const prevState = state.state;
            state.state = nextState;
            Logger.add('[HEALER:STATE] State transition', {
                from: prevState,
                to: nextState,
                reason,
                videoState: getVideoState(video)
            });
        };

        const handlers = {
            timeupdate: () => {
                state.lastProgressTime = Date.now();
                state.lastTime = video.currentTime;
                if (state.state !== 'PLAYING') {
                    Logger.add('[HEALER:EVENT] timeupdate', {
                        state: state.state,
                        videoState: getVideoState(video)
                    });
                }
                if (state.state !== 'HEALING') {
                    setState('PLAYING', 'timeupdate');
                }
            },
            playing: () => {
                state.lastProgressTime = Date.now();
                Logger.add('[HEALER:EVENT] playing', {
                    state: state.state,
                    videoState: getVideoState(video)
                });
                if (state.state !== 'HEALING') {
                    setState('PLAYING', 'playing');
                }
            },
            waiting: () => {
                Logger.add('[HEALER:EVENT] waiting', {
                    state: state.state,
                    videoState: getVideoState(video)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'waiting');
                }
            },
            stalled: () => {
                Logger.add('[HEALER:EVENT] stalled', {
                    state: state.state,
                    videoState: getVideoState(video)
                });
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'stalled');
                }
            },
            pause: () => {
                Logger.add('[HEALER:EVENT] pause', {
                    state: state.state,
                    videoState: getVideoState(video)
                });
                setState('PAUSED', 'pause');
            }
        };

        let intervalId;

        const start = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.addEventListener(event, handler);
            });

            intervalId = setInterval(() => {
                if (!document.contains(video)) {
                    Logger.add('[HEALER:CLEANUP] Video removed from DOM');
                    onRemoved();
                    return;
                }

                if (isHealing()) {
                    return;
                }

                if (video.paused) {
                    setState('PAUSED', 'watchdog_paused');
                    return;
                }

                const stalledForMs = Date.now() - state.lastProgressTime;
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

                const now = Date.now();
                if (now - state.lastWatchdogLogTime > 5000) {
                    state.lastWatchdogLogTime = now;
                    Logger.add('[HEALER:WATCHDOG] No progress observed', {
                        stalledForMs,
                        bufferExhausted,
                        state: state.state,
                        videoState: getVideoState(video)
                    });
                }

                onStall({
                    trigger: 'WATCHDOG',
                    stalledFor: stalledForMs + 'ms',
                    bufferExhausted
                }, state);
            }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stop = () => {
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
