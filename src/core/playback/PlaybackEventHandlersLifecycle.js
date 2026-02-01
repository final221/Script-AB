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
        const transitions = options.transitions;
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
                transitions.toEnded('ended');
            },
            error: () => {
                state.pauseFromStall = false;
                logEvent('error', () => ({
                    state: state.state
                }));
                transitions.toError('error');
            },
            abort: () => {
                state.pauseFromStall = false;
                logEvent('abort', () => ({
                    state: state.state
                }));
                transitions.toPaused('abort', { allowDuringHealing: true });
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
