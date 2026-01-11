// --- PlaybackMonitor ---
/**
 * Tracks playback progress using media events plus a watchdog interval.
 * Emits stall detection callbacks while keeping event/state logging centralized.
 */
const PlaybackMonitor = (() => {
    const LOG = {
        STATE: '[HEALER:STATE]'
    };

    const create = (video, options = {}) => {
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});
        const onRemoved = options.onRemoved || (() => {});
        const onReset = options.onReset || (() => {});
        const isActive = options.isActive || (() => true);
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

        const eventHandlers = PlaybackEventHandlers.create({
            video,
            videoId,
            logDebug,
            tracker,
            state,
            setState,
            onReset
        });

        const watchdog = PlaybackWatchdog.create({
            video,
            videoId,
            logDebug,
            tracker,
            state,
            setState,
            isHealing,
            isActive,
            onRemoved,
            onStall
        });

        const start = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor started', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            eventHandlers.attach();
            watchdog.start();
        };

        const stop = () => {
            logDebug('[HEALER:MONITOR] PlaybackMonitor stopped', {
                state: state.state,
                videoState: VideoState.get(video, videoId)
            });
            watchdog.stop();
            eventHandlers.detach();
        };

        return {
            start,
            stop,
            state
        };
    };

    return { create };
})();
