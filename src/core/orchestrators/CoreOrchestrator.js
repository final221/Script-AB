// ============================================================================
// 6. CORE ORCHESTRATOR (Stream Healer Edition)
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * STREAMLINED: Focus on stream healing, not ad blocking (uBO handles that).
 */
const CoreOrchestrator = (() => {
    return {
        init: () => {
            Logger.add('[CORE] Initializing Stream Healer');

            // Expose debug functions robustly (including iframe proxy)
            const exposeGlobal = (name, fn) => {
                try {
                    window[name] = fn;
                    if (typeof unsafeWindow !== 'undefined') {
                        unsafeWindow[name] = fn;
                    }
                } catch (e) {
                    console.error('[CORE] Failed to expose global:', name, e);
                }
            };

            if (window.self !== window.top) {
                exposeGlobal('exportTwitchAdLogs', () => {
                    try {
                        if (window.top && typeof window.top.exportTwitchAdLogs === 'function') {
                            window.top.exportTwitchAdLogs();
                            return;
                        }
                    } catch (e) {
                        Logger.add('[CORE] exportTwitchAdLogs proxy failed', { error: e?.message });
                    }
                    Logger.add('[CORE] exportTwitchAdLogs not available in top window');
                });
                return;
            }

            const streamHealer = StreamHealer.create();
            StreamHealer.setDefault(streamHealer);

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

            exposeGlobal('exportTwitchAdLogs', () => {
                const healerStats = streamHealer.getStats();
                const metricsSummary = Metrics.getSummary();
                const mergedLogs = Logger.getMergedTimeline();
                ReportGenerator.exportReport(metricsSummary, mergedLogs, healerStats);
            });

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

