// ============================================================================
// 6. CORE ORCHESTRATOR (Stream Healer Edition)
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * STREAMLINED: Focus on stream healing, not ad blocking (uBO handles that).
 */
const CoreOrchestrator = (() => {
    let streamHealer = null;

    const exposeGlobal = (name, fn) => {
        try {
            window[name] = fn;
            if (typeof unsafeWindow !== 'undefined') {
                unsafeWindow[name] = fn;
            }
            if (typeof exportFunction === 'function' && window.wrappedJSObject) {
                exportFunction(fn, window.wrappedJSObject, { defineAs: name });
            } else if (window.wrappedJSObject) {
                window.wrappedJSObject[name] = fn;
            }
        } catch (e) {
            console.error('[CORE] Failed to expose global:', name, e);
        }
    };

    const ensureStreamHealer = () => {
        if (!streamHealer) {
            streamHealer = StreamHealer.create();
            StreamHealer.setDefault(streamHealer);
        }
        return streamHealer;
    };

    const exportLogs = () => {
        try {
            const healer = ensureStreamHealer();
            const healerStats = healer?.getStats ? healer.getStats() : {};
            const metricsSummary = Metrics?.getSummary ? Metrics.getSummary() : {};
            const mergedLogs = Logger?.getMergedTimeline ? Logger.getMergedTimeline() : [];
            ReportGenerator?.exportReport?.(metricsSummary, mergedLogs, healerStats);
        } catch (error) {
            Logger?.add?.('[CORE] exportTwitchAdLogs failed', { error: error?.message });
        }
    };

    const exportLogsProxy = () => {
        try {
            if (window.top && typeof window.top.exportTwitchAdLogs === 'function') {
                window.top.exportTwitchAdLogs();
                return;
            }
        } catch (e) {
            Logger?.add?.('[CORE] exportTwitchAdLogs proxy failed', { error: e?.message });
        }
        Logger?.add?.('[CORE] exportTwitchAdLogs not available in top window');
    };

    return {
        init: () => {
            Logger.add('[CORE] Initializing Stream Healer');

            const isTopWindow = window.self === window.top;
            exposeGlobal('exportTwitchAdLogs', isTopWindow ? exportLogs : exportLogsProxy);

            if (!isTopWindow) {
                return;
            }

            const streamHealer = ensureStreamHealer();

            // Initialize essential modules only
            Instrumentation.init({
                onSignal: streamHealer.handleExternalSignal
            });  // Console capture + external hints

            // Wait for DOM then start monitoring
            const startMonitoring = () => {
                VideoDiscovery.start((video) => {
                    streamHealer.monitor(video);
                });
            };

            if (document.body) {
                startMonitoring();
            } else {
                document.addEventListener('DOMContentLoaded', startMonitoring, { once: true });
            }

            Logger.add('[CORE] Stream Healer ready', {
                config: {
                    watchdogInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                    healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
                }
            });

            const warnings = ConfigValidator.validate(CONFIG);
            if (warnings.length > 0) {
                Logger.add('[CORE] Config validation warnings', {
                    count: warnings.length,
                    warnings
                });
            }
        }
    };
})();

CoreOrchestrator.init();

