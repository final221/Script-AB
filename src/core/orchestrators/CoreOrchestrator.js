// ============================================================================
// 6. CORE ORCHESTRATOR (Stream Healer Edition)
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * STREAMLINED: Focus on stream healing, not ad blocking (uBO handles that).
 */
const CoreOrchestrator = (() => {
    let streamHealer = null;
    const EXPORT_MESSAGE_TYPE = 'TSH_EXPORT_LOGS';

    const exposeGlobal = (name, fn) => {
        const targets = [];

        if (typeof globalThis !== 'undefined') {
            targets.push(globalThis);
        }
        if (typeof window !== 'undefined' && window !== globalThis) {
            targets.push(window);
        }
        if (typeof unsafeWindow !== 'undefined') {
            targets.push(unsafeWindow);
        }

        const uniqueTargets = Array.from(new Set(targets));

        uniqueTargets.forEach((target) => {
            try {
                target[name] = fn;
            } catch (error) {
                Logger?.add?.('[CORE] Failed to expose global target', {
                    name,
                    error: error?.message
                });
            }
        });

        if (typeof exportFunction === 'function') {
            uniqueTargets.forEach((target) => {
                const rawTarget = target?.wrappedJSObject || target;
                try {
                    exportFunction(fn, rawTarget, { defineAs: name });
                } catch (error) {
                    Logger?.add?.('[CORE] Failed to export function', {
                        name,
                        error: error?.message
                    });
                }
            });
        } else {
            uniqueTargets.forEach((target) => {
                if (!target?.wrappedJSObject) return;
                try {
                    target.wrappedJSObject[name] = fn;
                } catch (error) {
                    Logger?.add?.('[CORE] Failed to expose wrapped global', {
                        name,
                        error: error?.message
                    });
                }
            });
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

    const installExportBridge = () => {
        const handler = (event) => {
            if (!event || event.source !== window) return;
            const data = event.data;
            if (!data || data.type !== EXPORT_MESSAGE_TYPE || data.source !== 'tsh') return;
            exportLogs();
        };

        window.addEventListener('message', handler);

        const inject = () => {
            const root = document.documentElement || document.head || document.body;
            if (!root) return false;
            try {
                const script = document.createElement('script');
                script.textContent = `(() => {
                    try {
                        const msg = { source: 'tsh', type: '${EXPORT_MESSAGE_TYPE}' };
                        const exportFn = () => window.postMessage(msg, '*');
                        window.exportStreamHealerLogs = window.exportStreamHealerLogs || exportFn;
                        window.exportTwitchAdLogs = window.exportTwitchAdLogs || exportFn;
                        window.exporttwitchadlogs = window.exporttwitchadlogs || exportFn;
                        window.StreamHealer = window.StreamHealer || { exportLogs: exportFn };
                    } catch (e) {}
                })();`;
                root.appendChild(script);
                root.removeChild(script);
                return true;
            } catch (error) {
                Logger?.add?.('[CORE] Failed to inject export bridge', { error: error?.message });
                return false;
            }
        };

        if (!inject()) {
            document.addEventListener('DOMContentLoaded', inject, { once: true });
        }
    };

    return {
        init: () => {
            Logger.add('[CORE] Initializing Stream Healer');

            installExportBridge();

            const isTopWindow = window.self === window.top;
            const exportFn = isTopWindow ? exportLogs : exportLogsProxy;
            exposeGlobal('exportTwitchAdLogs', exportFn);
            exposeGlobal('exporttwitchadlogs', exportFn);
            exposeGlobal('StreamHealer', StreamHealer);
            exposeGlobal('exportStreamHealerLogs', () => StreamHealer.exportLogs());
            exposeGlobal('exportstreamhealerlogs', () => StreamHealer.exportLogs());

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

