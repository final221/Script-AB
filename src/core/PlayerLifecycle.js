// --- Player Lifecycle ---
/**
 * Manages player container lifecycle (mount/unmount).
 * @responsibility
 * 1. Track active player container.
 * 2. Setup player-specific observers.
 * 3. Coordinate with VideoListenerManager and HealthMonitor.
 */
const PlayerLifecycle = (() => {
    let activeContainer = null;
    let playerObserver = null;

    return {
        getActiveContainer: () => activeContainer,

        inject: () => {
            Store.update({ lastAttempt: Date.now() });
            Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
        },

        handleMount: (container) => {
            if (activeContainer === container) return;
            if (activeContainer) PlayerLifecycle.handleUnmount();

            Logger.add('Player mounted');
            activeContainer = container;

            const debouncedInject = Fn.debounce(() => PlayerLifecycle.inject(), 100);
            playerObserver = Adapters.DOM.observe(container, (mutations) => {
                const shouldReacquire = mutations.some(m => {
                    if (m.type === 'attributes' && m.attributeName === 'class' && m.target === container) {
                        return true;
                    }
                    if (m.type === 'childList') {
                        const hasVideo = (nodes) => Array.from(nodes).some(n =>
                            n.matches && n.matches(CONFIG.selectors.VIDEO)
                        );
                        return hasVideo(m.addedNodes) || hasVideo(m.removedNodes);
                    }
                    return false;
                });
                if (shouldReacquire) debouncedInject();
            }, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            VideoListenerManager.attach(container);
            PlayerLifecycle.inject();
        },

        handleUnmount: () => {
            if (!activeContainer) return;
            Logger.add('Player unmounted');

            if (playerObserver) {
                playerObserver.disconnect();
                playerObserver = null;
            }

            VideoListenerManager.detach();
            HealthMonitor.stop();
            PlayerContext.reset();
            activeContainer = null;
        }
    };
})();
