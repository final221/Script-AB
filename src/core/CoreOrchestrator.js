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

            // Don't run in iframes
            if (window.self !== window.top) return;

            // Initialize essential modules only
            Instrumentation.init();  // Console capture for debugging

            // Wait for DOM then start monitoring
            const startMonitoring = () => {
                // Find video element and start StreamHealer
                const findAndMonitorVideo = () => {
                    const video = document.querySelector('video');
                    if (video) {
                        Logger.add('[CORE] Video element found, starting StreamHealer');
                        StreamHealer.monitor(video);
                    }
                };

                // Try immediately
                findAndMonitorVideo();

                // Also observe for new videos
                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeName === 'VIDEO' ||
                                (node.querySelector && node.querySelector('video'))) {
                                Logger.add('[CORE] New video detected in DOM');
                                findAndMonitorVideo();
                            }
                        }
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                Logger.add('[CORE] DOM observer started');
            };

            if (document.body) {
                startMonitoring();
            } else {
                document.addEventListener('DOMContentLoaded', startMonitoring, { once: true });
            }

            // Expose debug functions robustly
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

            exposeGlobal('forceTwitchHeal', () => {
                const video = document.querySelector('video');
                if (video) {
                    Logger.add('[CORE] Manual heal triggered');
                    StreamHealer.onStallDetected(video, { trigger: 'MANUAL' });
                } else {
                    console.log('No video element found');
                }
            });

            exposeGlobal('getTwitchHealerStats', () => {
                return {
                    healer: StreamHealer.getStats(),
                    metrics: Metrics.getSummary()
                };
            });

            exposeGlobal('exportTwitchAdLogs', () => {
                const metricsSummary = Metrics.getSummary();
                const mergedLogs = Logger.getMergedTimeline();
                ReportGenerator.exportReport(metricsSummary, mergedLogs);
            });

            Logger.add('[CORE] Stream Healer ready', {
                config: {
                    detectionInterval: CONFIG.stall.DETECTION_INTERVAL_MS + 'ms',
                    stuckTrigger: CONFIG.stall.STUCK_COUNT_TRIGGER + ' checks',
                    healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
                }
            });
        }
    };
})();

CoreOrchestrator.init();


