// @module CoreOrchestrator
// @depends CoreDebugHooks, Instrumentation, StreamHealer, Validate, VideoDiscovery
// ============================================================================
// 6. CORE ORCHESTRATOR (Stream Healer Edition)
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * STREAMLINED: Focus on stream healing, not ad blocking (uBO handles that).
 */
const CoreOrchestrator = (() => {
    let streamHealer = null;

    const ensureStreamHealer = () => {
        if (!streamHealer) {
            streamHealer = StreamHealer.create();
            StreamHealer.setDefault(streamHealer);
        }
        return streamHealer;
    };

    const installDebugHooks = (isTopWindow) => {
        const hooks = CoreDebugHooks.create({
            ensureStreamHealer,
            isTopWindow
        });
        hooks.installGlobals();
        return hooks;
    };

    const initializeInstrumentation = (healer) => {
        Instrumentation.init({
            onSignal: healer.handleExternalSignal
        });
    };

    const startVideoDiscovery = (healer) => {
        VideoDiscovery.start((video) => {
            healer.monitor(video);
        });
    };

    const startMonitoringWhenReady = (healer) => {
        const startMonitoring = () => {
            startVideoDiscovery(healer);
        };

        if (document.body) {
            startMonitoring();
            return;
        }

        document.addEventListener('DOMContentLoaded', startMonitoring, { once: true });
    };

    const logReadyState = () => {
        Logger.add('[CORE] Stream Healer ready', {
            config: {
                watchdogInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
            }
        });
    };

    const logConfigWarnings = () => {
        const warnings = ConfigValidator.validate(CONFIG);
        if (warnings.length > 0) {
            Logger.add('[CORE] Config validation warnings', {
                count: warnings.length,
                warnings
            });
        }
    };

    const bootstrapTopWindow = () => {
        const healer = ensureStreamHealer();
        initializeInstrumentation(healer);
        startMonitoringWhenReady(healer);
        logReadyState();
        logConfigWarnings();
    };

    return {
        init: () => {
            Logger.add('[CORE] Initializing Stream Healer');

            const isTopWindow = window.self === window.top;
            installDebugHooks(isTopWindow);

            if (!isTopWindow) {
                return;
            }

            bootstrapTopWindow();
        }
    };
})();

CoreOrchestrator.init();
