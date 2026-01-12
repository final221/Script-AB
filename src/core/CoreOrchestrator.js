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
            Instrumentation.init({
                onSignal: StreamHealer.handleExternalSignal
            });  // Console capture + external hints

            // Wait for DOM then start monitoring
            const startMonitoring = () => {
                // Find video element and start StreamHealer
                const collectVideos = (targetNode) => {
                    if (targetNode) {
                        if (targetNode.nodeName === 'VIDEO') {
                            return [targetNode];
                        }
                        if (targetNode.querySelectorAll) {
                            return Array.from(targetNode.querySelectorAll('video'));
                        }
                        return [];
                    }
                    return Array.from(document.querySelectorAll('video'));
                };

                const findAndMonitorVideo = (targetNode) => {
                    // If targetNode is provided, scan its subtree. Otherwise scan document.
                    const videos = collectVideos(targetNode);
                    if (!videos.length) {
                        return;
                    }

                    Logger.add('[CORE] New video detected in DOM', {
                        count: videos.length
                    });
                    Logger.add('[CORE] Video elements found, starting StreamHealer', {
                        count: videos.length
                    });
                    videos.forEach(video => StreamHealer.monitor(video));
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
