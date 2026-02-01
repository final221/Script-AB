// --- PlaybackEventHandlersStall ---
/**
 * Stall-related playback event handlers.
 */
const PlaybackEventHandlersStall = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const tracker = options.tracker;
        const state = options.state;
        const transitions = options.transitions;
        const logEvent = options.logEvent;

        return {
            waiting: () => {
                tracker.markStallEvent('waiting');
                logEvent('waiting', () => ({
                    state: state.state
                }));
                if (!video.paused) {
                    transitions.toStalled('waiting');
                }
            },
            stalled: () => {
                tracker.markStallEvent('stalled');
                logEvent('stalled', () => ({
                    state: state.state
                }));
                if (!video.paused) {
                    transitions.toStalled('stalled');
                }
            },
            pause: () => {
                const bufferExhausted = MediaState.isBufferExhausted(video);
                logEvent('pause', () => ({
                    state: state.state,
                    bufferExhausted
                }));
                if (bufferExhausted && !video.ended) {
                    tracker.markStallEvent('pause_buffer_exhausted');
                    transitions.toStalled('pause_buffer_exhausted');
                    return;
                }
                transitions.toPaused('pause', { allowDuringHealing: true });
            }
        };
    };

    return { create };
})();
