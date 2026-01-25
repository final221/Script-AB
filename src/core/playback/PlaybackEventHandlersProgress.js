// --- PlaybackEventHandlersProgress ---
/**
 * Progress-related playback event handlers.
 */
const PlaybackEventHandlersProgress = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const logEvent = options.logEvent;

        return {
            timeupdate: () => {
                tracker.updateProgress('timeupdate');
                if (state.state !== MonitorStates.PLAYING) {
                    logEvent('timeupdate', () => ({
                        state: state.state
                    }));
                }
                if (!video.paused && state.state !== MonitorStates.HEALING) {
                    setState(MonitorStates.PLAYING, 'timeupdate');
                }
            }
        };
    };

    return { create };
})();
