// --- Event Coordinator ---
/**
 * Sets up EventBus listeners and coordinates event responses.
 * @responsibility Wire up global event listeners for ACQUIRE and AD_DETECTED.
 */
const EventCoordinator = (() => {
    return {
        init: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, () => {
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    if (PlayerContext.get(container)) {
                        Logger.add('Event: ACQUIRE - Success');
                        HealthMonitor.start(container);
                    } else {
                        Logger.add('Event: ACQUIRE - Failed');
                    }
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
                Logger.add('Event: AD_DETECTED');
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    ResilienceOrchestrator.execute(container);
                }
            });
        }
    };
})();
