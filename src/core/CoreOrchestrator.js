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
                const findAndMonitorVideo = (targetNode) => {
                    // If targetNode is provided, use it. Otherwise search document.
                    // But critical: only monitor if it is/contains a video
                    let video = null;

                    if (targetNode) {
                        if (targetNode.nodeName === 'VIDEO') {
                            video = targetNode;
                        } else if (targetNode.querySelector) {
                            video = targetNode.querySelector('video');
                        }
                    } else {
                        video = document.querySelector('video');
                    }

                    if (video) {
                        Logger.add('[CORE] New video detected in DOM');
                        Logger.add('[CORE] Video element found, starting StreamHealer');
                        StreamHealer.monitor(video);
                    }
                };

                // Try immediately (initial page load)
                findAndMonitorVideo();

                // Also observe for new videos
                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            // Only check relevant nodes
                            if (node.nodeName === 'VIDEO' ||
                                (node.nodeName === 'DIV' && node.querySelector && node.querySelector('video'))) {
                                // Pass the specific node to avoid global lookup of existing video
                                findAndMonitorVideo(node);
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
                    watchdogInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                    healTimeout: CONFIG.stall.HEAL_TIMEOUT_S + 's'
                }
            });
        }
    };
})();

CoreOrchestrator.init();
