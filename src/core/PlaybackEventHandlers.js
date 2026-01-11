// --- PlaybackEventHandlers ---
/**
 * Wires media element events to playback state tracking.
 */
const PlaybackEventHandlers = (() => {
    const LOG = {
        EVENT: '[HEALER:EVENT]'
    };

    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const onReset = options.onReset || (() => {});

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
                const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
                logDebug(`${LOG.EVENT} pause`, {
                    state: state.state,
                    bufferExhausted,
                    videoState: VideoState.get(video, videoId)
                });
                if (bufferExhausted && !video.ended) {
                    tracker.markStallEvent('pause_buffer_exhausted');
                    if (state.state !== 'HEALING') {
                        setState('STALLED', 'pause_buffer_exhausted');
                    }
                    return;
                }
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

        const attach = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.addEventListener(event, handler);
            });
        };

        const detach = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.removeEventListener(event, handler);
            });
        };

        return {
            attach,
            detach
        };
    };

    return { create };
})();
