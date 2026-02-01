// --- PlaybackEventHandlers ---
/**
 * Wires media element events to playback state tracking.
 */
const PlaybackEventHandlers = (() => {
    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const transitions = options.transitions;
        const onReset = options.onReset || (() => {});
        const isActive = options.isActive || (() => true);
        const eventLogger = PlaybackEventLogger.create({
            logDebug,
            state,
            isActive
        });
        const logEvent = eventLogger.logEvent;

        const handlerOptions = {
            video,
            videoId,
            tracker,
            state,
            transitions,
            onReset,
            logEvent
        };

        const handlers = {
            ...PlaybackEventHandlersProgress.create(handlerOptions),
            ...PlaybackEventHandlersReady.create(handlerOptions),
            ...PlaybackEventHandlersStall.create(handlerOptions),
            ...PlaybackEventHandlersLifecycle.create(handlerOptions)
        };

        const attach = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.addEventListener(event, handler);
            });
        };

        const detach = () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                video.removeEventListener(event, handler);
            });
        };

        return {
            attach,
            detach
        };
    };

    return { create };
})();
