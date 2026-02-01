// --- PlaybackEventHandlersReady ---
/**
 * Ready/playback-start event handlers.
 */
const PlaybackEventHandlersReady = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const tracker = options.tracker;
        const state = options.state;
        const transitions = options.transitions;
        const logEvent = options.logEvent;

        return {
            playing: () => {
                tracker.markReady('playing');
                state.pauseFromStall = false;
                state.lastTime = video.currentTime;
                logEvent('playing', () => ({
                    state: state.state
                }));
                transitions.toPlaying('playing');
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
