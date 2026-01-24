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
        const isActive = options.isActive || (() => true);

        const ALWAYS_LOG_EVENTS = new Set(['abort', 'emptied', 'error', 'ended']);

        const logEvent = (event, detailFactory = null) => {
            if (!CONFIG.debug) return;
            const now = Date.now();
            const detail = typeof detailFactory === 'function'
                ? detailFactory()
                : (detailFactory || {});

            if (ALWAYS_LOG_EVENTS.has(event)) {
                logDebug(`${LOG.EVENT} ${event}`, detail);
                return;
            }

            if (isActive()) {
                const counts = state.activeEventCounts || {};
                counts[event] = (counts[event] || 0) + 1;
                state.activeEventCounts = counts;

                const lastActive = state.lastActiveEventLogTime || 0;
                if (now - lastActive >= CONFIG.logging.ACTIVE_EVENT_LOG_MS) {
                    state.lastActiveEventLogTime = now;
                    logDebug(`${LOG.EVENT} ${event}`, detail);
                }

                const lastSummary = state.lastActiveEventSummaryTime || 0;
                if (now - lastSummary >= CONFIG.logging.ACTIVE_EVENT_SUMMARY_MS) {
                    state.lastActiveEventSummaryTime = now;
                    const summary = { ...counts };
                    state.activeEventCounts = {};
                    logDebug('[HEALER:EVENT_SUMMARY] Active event summary', {
                        events: summary,
                        sinceMs: lastSummary ? (now - lastSummary) : null,
                        state: state.state,
                        videoState: VideoState.get(video, videoId)
                    });
                }
                return;
            }

            const counts = state.nonActiveEventCounts || {};
            counts[event] = (counts[event] || 0) + 1;
            state.nonActiveEventCounts = counts;

            const lastLog = state.lastNonActiveEventLogTime || 0;
            if (now - lastLog < CONFIG.logging.NON_ACTIVE_LOG_MS) {
                return;
            }

            state.lastNonActiveEventLogTime = now;
            const summary = { ...counts };
            state.nonActiveEventCounts = {};

            logDebug('[HEALER:EVENT_SUMMARY] Non-active event summary', {
                events: summary,
                sinceMs: lastLog ? (now - lastLog) : null,
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
        };

        const handlers = {
            timeupdate: () => {
                tracker.updateProgress('timeupdate');
                if (state.state !== 'PLAYING') {
                logEvent('timeupdate', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                }
                if (!video.paused && state.state !== 'HEALING') {
                    setState('PLAYING', 'timeupdate');
                }
            },
            playing: () => {
                tracker.markReady('playing');
                state.pauseFromStall = false;
                state.lastTime = video.currentTime;
                logEvent('playing', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                if (state.state !== 'HEALING') {
                    setState('PLAYING', 'playing');
                }
            },
            loadedmetadata: () => {
                tracker.markReady('loadedmetadata');
                logEvent('loadedmetadata', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
            },
            loadeddata: () => {
                tracker.markReady('loadeddata');
                logEvent('loadeddata', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
            },
            canplay: () => {
                tracker.markReady('canplay');
                logEvent('canplay', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
            },
            waiting: () => {
                tracker.markStallEvent('waiting');
                logEvent('waiting', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'waiting');
                }
            },
            stalled: () => {
                tracker.markStallEvent('stalled');
                logEvent('stalled', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                if (!video.paused && state.state !== 'HEALING') {
                    setState('STALLED', 'stalled');
                }
            },
            pause: () => {
                const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
                logEvent('pause', () => ({
                    state: state.state,
                    bufferExhausted,
                    videoState: VideoState.get(video, videoId)
                }));
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
                logEvent('ended', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                Logger.add('[HEALER:ENDED] Video ended', {
                    videoId,
                    videoState: VideoState.get(video, videoId)
                });
                setState('ENDED', 'ended');
            },
            error: () => {
                state.pauseFromStall = false;
                logEvent('error', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                setState('ERROR', 'error');
            },
            abort: () => {
                state.pauseFromStall = false;
                logEvent('abort', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                setState('PAUSED', 'abort');
                tracker.handleReset('abort', onReset);
            },
            emptied: () => {
                state.pauseFromStall = false;
                logEvent('emptied', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
                tracker.handleReset('emptied', onReset);
            },
            suspend: () => {
                logEvent('suspend', () => ({
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                }));
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
