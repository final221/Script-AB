// --- PlaybackEventHandlersStall ---
/**
 * Stall-related playback event handlers.
 */
const PlaybackEventHandlersStall = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const logEvent = options.logEvent;

        return {
            waiting: () => {
                tracker.markStallEvent('waiting');
                logEvent('waiting', () => ({
                    state: state.state
                }));
                if (!video.paused && state.state !== MonitorStates.HEALING) {
                    setState(MonitorStates.STALLED, 'waiting');
                }
            },
            stalled: () => {
                tracker.markStallEvent('stalled');
                logEvent('stalled', () => ({
                    state: state.state
                }));
                if (!video.paused && state.state !== MonitorStates.HEALING) {
                    setState(MonitorStates.STALLED, 'stalled');
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
                    if (state.state !== MonitorStates.HEALING) {
                        setState(MonitorStates.STALLED, 'pause_buffer_exhausted');
                    }
                    return;
                }
                setState(MonitorStates.PAUSED, 'pause');
            }
        };
    };

    return { create };
})();
