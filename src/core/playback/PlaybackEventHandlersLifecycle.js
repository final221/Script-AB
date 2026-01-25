// --- PlaybackEventHandlersLifecycle ---
/**
 * Lifecycle event handlers (ended/error/abort/emptied/suspend).
 */
const PlaybackEventHandlersLifecycle = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const onReset = options.onReset || (() => {});
        const logEvent = options.logEvent;

        return {
            ended: () => {
                state.pauseFromStall = false;
                logEvent('ended', () => ({
                    state: state.state
                }));
                Logger.add(LogEvents.tagged('ENDED', 'Video ended'), {
                    videoId,
                    currentTime: Number.isFinite(video.currentTime)
                        ? Number(video.currentTime.toFixed(3))
                        : null
                });
                setState(MonitorStates.ENDED, 'ended');
            },
            error: () => {
                state.pauseFromStall = false;
                logEvent('error', () => ({
                    state: state.state
                }));
                setState(MonitorStates.ERROR, 'error');
            },
            abort: () => {
                state.pauseFromStall = false;
                logEvent('abort', () => ({
                    state: state.state
                }));
                setState(MonitorStates.PAUSED, 'abort');
                tracker.handleReset('abort', onReset);
            },
            emptied: () => {
                state.pauseFromStall = false;
                logEvent('emptied', () => ({
                    state: state.state
                }));
                tracker.handleReset('emptied', onReset);
            },
            suspend: () => {
                logEvent('suspend', () => ({
                    state: state.state
                }));
            }
        };
    };

    return { create };
})();
