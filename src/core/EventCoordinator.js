// --- Event Coordinator ---
/**
 * Sets up EventBus listeners and coordinates event responses.
 * @responsibility Wire up global event listeners for ACQUIRE and AD_DETECTED.
 */
const EventCoordinator = (() => {
    return {
        init: () => {
            Adapters.EventBus.on(CONFIG.events.ACQUIRE, (payload) => {
                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    const playerContext = PlayerContext.get(container);
                    if (playerContext) {
                        Logger.add('[LIFECYCLE] Event: ACQUIRE - Success', payload);
                        HealthMonitor.start(container);

                        // Plan B: Apply player patches if enabled
                        if (CONFIG.experimental?.ENABLE_PLAYER_PATCHING &&
                            typeof PlayerPatcher !== 'undefined') {
                            PlayerPatcher.apply(playerContext);
                        }
                    } else {
                        Logger.add('[LIFECYCLE] Event: ACQUIRE - Failed', payload);
                    }
                }
            });

            Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
                // Enhanced logging with source and trigger context
                if (payload?.source) {
                    const triggerInfo = payload.trigger ? ` | Trigger: ${payload.trigger}` : '';
                    const reasonInfo = payload.reason ? ` | Reason: ${payload.reason}` : '';
                    Logger.add(`[EVENT] AD_DETECTED | Source: ${payload.source}${triggerInfo}${reasonInfo}`, payload.details || {});
                } else {
                    // Fallback for events without payload (backward compatibility)
                    Logger.add('[EVENT] AD_DETECTED | Source: UNKNOWN');
                }

                const container = PlayerLifecycle.getActiveContainer();
                if (container) {
                    ResilienceOrchestrator.execute(container, payload);
                }
            });
        }
    };
})();
