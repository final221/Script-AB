// --- PlaybackEventHandlersReady ---
/**
 * Ready/playback-start event handlers.
 */
const PlaybackEventHandlersReady = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const logEvent = options.logEvent;

        return {
            playing: () => {
                tracker.markReady('playing');
                state.pauseFromStall = false;
                state.lastTime = video.currentTime;
                logEvent('playing', () => ({
                    state: state.state
                }));
                if (state.state !== MonitorStates.HEALING) {
                    setState(MonitorStates.PLAYING, 'playing');
                }
            },
            loadedmetadata: () => {
                tracker.markReady('loadedmetadata');
                logEvent('loadedmetadata', () => ({
                    state: state.state
                }));
            },
            loadeddata: () => {
                tracker.markReady('loadeddata');
                logEvent('loadeddata', () => ({
                    state: state.state
                }));
            },
            canplay: () => {
                tracker.markReady('canplay');
                logEvent('canplay', () => ({
                    state: state.state
                }));
            }
        };
    };

    return { create };
})();
