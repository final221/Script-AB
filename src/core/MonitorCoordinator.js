// --- MonitorCoordinator ---
/**
 * Coordinates monitor registry and candidate selection lifecycle.
 */
const MonitorCoordinator = (() => {
    const create = (options = {}) => {
        const monitorRegistry = options.monitorRegistry;
        const candidateSelector = options.candidateSelector;
        const logDebug = options.logDebug || (() => {});

        const monitorsById = monitorRegistry.monitorsById;
        const getVideoId = monitorRegistry.getVideoId;

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
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video to escape stale state'), {
                videoId,
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
