// --- PlaybackEventHandlersStall ---
/**
 * Stall-related playback event handlers.
 */
const PlaybackEventHandlersStall = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const state = options.state;
        const stallMachine = options.stallMachine;
        const logEvent = options.logEvent;

        return {
            waiting: () => {
                logEvent('waiting', () => ({
                    state: state.state
                }));
                stallMachine.handleMediaEvent('waiting', { paused: video.paused });
            },
            stalled: () => {
                logEvent('stalled', () => ({
                    state: state.state
                }));
                stallMachine.handleMediaEvent('stalled', { paused: video.paused });
            },
            pause: () => {
                const bufferExhausted = MediaState.isBufferExhausted(video);
                logEvent('pause', () => ({
                    state: state.state,
                    bufferExhausted
                }));
                stallMachine.handleMediaEvent('pause', {
                    bufferExhausted,
                    ended: video.ended
                });
            }
        };
    };

    return { create };
})();
