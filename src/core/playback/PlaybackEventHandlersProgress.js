// --- PlaybackEventHandlersProgress ---
/**
 * Progress-related playback event handlers.
 */
const PlaybackEventHandlersProgress = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const tracker = options.tracker;
        const state = options.state;
        const transitions = options.transitions;
        const logEvent = options.logEvent;

        return {
            timeupdate: () => {
                tracker.updateProgress('timeupdate');
                if (state.state !== MonitorStates.PLAYING) {
                    logEvent('timeupdate', () => ({
                        state: state.state
                    }));
                }
                if (!video.paused) {
                    transitions.toPlaying('timeupdate');
                }
            }
        };
    };

    return { create };
})();
