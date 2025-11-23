// ============================================================================
// 6. CORE ORCHESTRATOR
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * @responsibility Initialize all modules in the correct order.
 */
const CoreOrchestrator = (() => {
    return {
        init: () => {
            Logger.add('Core initialized');

            // Don't run in iframes
            if (window.self !== window.top) return;

            // Check throttling
            const { lastAttempt, errorCount } = Store.get();
            if (errorCount >= CONFIG.timing.LOG_THROTTLE &&
                Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS) {
                if (CONFIG.debug) {
                    console.warn('[MAD-3000] Core throttled.');
                }
                return;
            }

            // Initialize modules in order
            NetworkManager.init();
            Instrumentation.init();
            EventCoordinator.init();
            ScriptBlocker.init();

            // Wait for DOM if needed
            if (document.body) {
                DOMObserver.init();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    DOMObserver.init();
                }, { once: true });
            }

            // Expose debug trigger
            window.forceTwitchAdRecovery = () => {
                Logger.add('Manual recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, { source: 'MANUAL_TRIGGER' });
            };

            window.forceTwitchAggressiveRecovery = () => {
                Logger.add('Manual AGGRESSIVE recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, { source: 'MANUAL_TRIGGER', forceAggressive: true });
            };
        }
    };
})();

CoreOrchestrator.init();
