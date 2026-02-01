// --- PlaybackStallStateMachine ---
/**
 * Centralizes stall-related state transitions.
 */
const PlaybackStallStateMachine = (() => {
    const create = (options = {}) => {
        const state = options.state;
        const video = options.video;
        const tracker = options.tracker;
        const transitions = options.transitions;

        const handleMediaEvent = (eventType, detail = {}) => {
            if (!state || !transitions || !tracker) return;
            if (eventType === 'pause') {
                if (detail.bufferExhausted && !detail.ended) {
                    tracker.markStallEvent('pause_buffer_exhausted');
                    transitions.toStalled('pause_buffer_exhausted');
                    return;
                }
                transitions.toPaused('pause', { allowDuringHealing: true });
                return;
            }
            tracker.markStallEvent(eventType);
            if (!detail.paused) {
                transitions.toStalled(eventType);
            }
        };

        const handleWatchdogPause = (bufferExhausted, pausedAfterStall) => {
            if (!state || !transitions || !tracker || !video) {
                return { pauseFromStall: false, shouldReturn: false };
            }
            let pauseFromStall = state.pauseFromStall || pausedAfterStall;
            if (video.paused && bufferExhausted && !pauseFromStall) {
                tracker.markStallEvent('watchdog_pause_buffer_exhausted');
                pauseFromStall = true;
            }
            if (video.paused && !pauseFromStall) {
                transitions.toPaused('watchdog_paused');
                return { pauseFromStall, shouldReturn: true };
            }
            if (video.paused && pauseFromStall && state.state !== MonitorStates.STALLED) {
                transitions.toStalled(bufferExhausted ? 'paused_buffer_exhausted' : 'paused_after_stall');
            }
            return { pauseFromStall, shouldReturn: false };
        };

        const handleWatchdogNoProgress = () => {
            if (!state || !transitions) return;
            if (state.state !== MonitorStates.STALLED) {
                transitions.toStalled('watchdog_no_progress');
            }
        };

        return {
            handleMediaEvent,
            handleWatchdogPause,
            handleWatchdogNoProgress
        };
    };

    return { create };
})();
