// --- PlaybackMonitor ---
/**
 * Tracks playback progress using media events plus a watchdog interval.
 * Emits stall detection callbacks while keeping event/state logging centralized.
 */
const PlaybackMonitor = (() => {
    const LOG = {
        STATE: LogEvents.TAG.STATE
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
            const snapshot = StateSnapshot.full(video, videoId);
            const summary = LogEvents.summary.stateChange({
                videoId,
                from: prevState,
                to: nextState,
                reason,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                paused: snapshot?.paused,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered,
                lastProgressAgoMs: state.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                progressStreakMs: state.progressStreakMs,
                progressEligible: state.progressEligible,
                pauseFromStall: state.pauseFromStall
            });
            logDebug(summary, {
                from: prevState,
                to: nextState,
                reason,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                paused: snapshot?.paused,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered,
                lastProgressAgoMs: state.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                progressStreakMs: state.progressStreakMs,
                progressEligible: state.progressEligible,
                pauseFromStall: state.pauseFromStall
            });
        };

        const eventHandlers = PlaybackEventHandlers.create({
            video,
            videoId,
            logDebug,
            tracker,
            state,
            setState,
            onReset,
            isActive
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
            logDebug(LogEvents.tagged('MONITOR', 'PlaybackMonitor started'), {
                state: state.state
            });
            eventHandlers.attach();
            watchdog.start();
        };

        const stop = () => {
            logDebug(LogEvents.tagged('MONITOR', 'PlaybackMonitor stopped'), {
                state: state.state
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
