// --- PlaybackStateTransitions ---
/**
 * Centralizes guarded playback state transitions.
 */
const PlaybackStateTransitions = (() => {
    const create = (options = {}) => {
        const state = options.state;
        const setState = options.setState || (() => false);

        const canTransition = (nextState, allowDuringHealing) => {
            if (!state) return false;
            if (state.state !== MonitorStates.HEALING) {
                return true;
            }
            if (nextState === MonitorStates.HEALING) {
                return true;
            }
            return allowDuringHealing === true;
        };

        const transition = (nextState, reason, options = {}) => {
            if (!canTransition(nextState, options.allowDuringHealing)) {
                return false;
            }
            return setState(nextState, reason);
        };

        return {
            transition,
            toPlaying: (reason) => transition(MonitorStates.PLAYING, reason),
            toPaused: (reason, options = {}) => transition(MonitorStates.PAUSED, reason, options),
            toStalled: (reason, options = {}) => transition(MonitorStates.STALLED, reason, options),
            toHealing: (reason) => transition(MonitorStates.HEALING, reason, { allowDuringHealing: true }),
            toEnded: (reason) => transition(MonitorStates.ENDED, reason, { allowDuringHealing: true }),
            toError: (reason) => transition(MonitorStates.ERROR, reason, { allowDuringHealing: true }),
            toReset: (reason) => transition(MonitorStates.RESET, reason, { allowDuringHealing: true })
        };
    };

    return { create };
})();
