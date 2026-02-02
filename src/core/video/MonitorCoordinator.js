// --- MonitorCoordinator ---
/**
 * Coordinates monitor registry and candidate selection lifecycle.
 */
const MonitorCoordinator = (() => {
    const create = (options = {}) => {
        const monitorRegistry = options.monitorRegistry;
        const candidateSelector = options.candidateSelector;
        const logDebug = options.logDebug || (() => {});
        const AUTO_REFRESH_STORAGE_KEY = 'twad_auto_refresh_at';

        const monitorsById = monitorRegistry.monitorsById;
        const getVideoId = monitorRegistry.getVideoId;

        const readAutoRefreshStamp = () => {
            try {
                return Number(sessionStorage.getItem(AUTO_REFRESH_STORAGE_KEY) || 0);
            } catch (error) {
                return 0;
            }
        };

        const writeAutoRefreshStamp = (now) => {
            try {
                sessionStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(now));
            } catch (error) {
                // ignore storage failures
            }
        };

        const canAutoRefresh = (now) => {
            if (!CONFIG.stall.AUTO_PAGE_REFRESH) {
                return { ok: false, reason: 'disabled' };
            }
            const lastRefreshAt = readAutoRefreshStamp();
            if (lastRefreshAt) {
                const elapsedMs = now - lastRefreshAt;
                if (elapsedMs < CONFIG.stall.REFRESH_COOLDOWN_MS) {
                    return {
                        ok: false,
                        reason: 'cooldown',
                        remainingMs: CONFIG.stall.REFRESH_COOLDOWN_MS - elapsedMs
                    };
                }
            }
            return { ok: true };
        };

        const getExportLogsFn = () => {
            if (typeof globalThis !== 'undefined' && typeof globalThis.exportTwitchAdLogs === 'function') {
                return globalThis.exportTwitchAdLogs;
            }
            if (typeof window !== 'undefined'
                && window.top
                && typeof window.top.exportTwitchAdLogs === 'function') {
                return window.top.exportTwitchAdLogs;
            }
            return null;
        };

        const attemptLogExport = () => {
            const exportFn = getExportLogsFn();
            if (!exportFn) {
                return { ok: false, reason: 'missing_export' };
            }
            try {
                exportFn();
                return { ok: true };
            } catch (error) {
                Logger.add(LogEvents.tagged('ERROR', 'Auto refresh log export failed'), {
                    error: error?.message
                });
                return { ok: false, reason: 'exception' };
            }
        };

        const scanForVideos = (reason, detail = {}) => {
            if (!document?.querySelectorAll) {
                return;
            }
            const beforeCount = monitorsById.size;
            const videos = Array.from(document.querySelectorAll('video'));
            Logger.add(LogEvents.tagged('SCAN', 'Video rescan requested'), {
                reason,
                found: videos.length,
                ...detail
            });
            for (const video of videos) {
                const videoId = getVideoId(video);
                logDebug(LogEvents.tagged('SCAN_ITEM', 'Video discovered'), {
                    reason,
                    videoId,
                    alreadyMonitored: monitorsById.has(videoId)
                });
            }
            for (const video of videos) {
                monitorRegistry.monitor(video);
            }
            candidateSelector.evaluateCandidates(`scan_${reason || 'manual'}`);
            candidateSelector.getActiveId();
            const afterCount = monitorsById.size;
            Logger.add(LogEvents.tagged('SCAN', 'Video rescan complete'), {
                reason,
                found: videos.length,
                newMonitors: Math.max(afterCount - beforeCount, 0),
                totalMonitors: afterCount
            });
        };

        const refreshVideo = (videoId, detail = {}) => {
            const entry = monitorsById.get(videoId);
            if (!entry) return false;
            const { video } = entry;
            const elementId = typeof monitorRegistry.getElementId === 'function'
                ? monitorRegistry.getElementId(video)
                : null;
            const now = Date.now();
            const autoRefresh = canAutoRefresh(now);
            if (autoRefresh.ok) {
                const exportResult = attemptLogExport();
                Logger.add(LogEvents.tagged('REFRESH', 'Auto page refresh scheduled'), {
                    videoId,
                    elementId,
                    detail,
                    exportOk: exportResult.ok,
                    exportReason: exportResult.reason || null,
                    delayMs: CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS
                });
                writeAutoRefreshStamp(now);
                setTimeout(() => {
                    window.location.reload();
                }, CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS);
                return true;
            }
            if (autoRefresh.reason === 'cooldown') {
                logDebug(LogEvents.tagged('REFRESH', 'Auto page refresh suppressed (cooldown)'), {
                    videoId,
                    elementId,
                    remainingMs: autoRefresh.remainingMs,
                    detail
                });
            }
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video to escape stale state'), {
                videoId,
                elementId,
                detail
            });
            monitorRegistry.stopMonitoring(video);
            monitorRegistry.resetVideoId(video);
            setTimeout(() => {
                scanForVideos('refresh', {
                    videoId,
                    ...detail
                });
            }, 100);
            return true;
        };

        return {
            monitor: monitorRegistry.monitor,
            stopMonitoring: monitorRegistry.stopMonitoring,
            scanForVideos,
            refreshVideo,
            monitorsById,
            getVideoId,
            getMonitoredCount: () => monitorRegistry.getMonitoredCount()
        };
    };

    return { create };
})();
