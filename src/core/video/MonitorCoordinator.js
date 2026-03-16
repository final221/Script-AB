// @module MonitorCoordinator
// @depends MonitorRegistry, RefreshCoordinator
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
                return null;
            }
            const beforeCount = monitorsById.size;
            const videos = Array.from(document.querySelectorAll('video'));
            const discovered = videos.map((video) => {
                const videoId = getVideoId(video);
                return {
                    video,
                    videoId,
                    alreadyMonitored: monitorsById.has(videoId)
                };
            });
            Logger.add(LogEvents.tagged('SCAN', 'Video rescan requested'), {
                reason,
                found: videos.length,
                ...detail
            });
            for (const item of discovered) {
                if (item.alreadyMonitored) {
                    continue;
                }
                logDebug(LogEvents.tagged('SCAN_ITEM', 'Video discovered'), {
                    reason,
                    videoId: item.videoId,
                    alreadyMonitored: false
                });
            }
            for (const item of discovered) {
                monitorRegistry.monitor(item.video);
            }
            const preferred = candidateSelector.evaluateCandidates(`scan_${reason || 'manual'}`);
            candidateSelector.getActiveId();
            const afterCount = monitorsById.size;
            Logger.add(LogEvents.tagged('SCAN', 'Video rescan complete'), {
                reason,
                found: videos.length,
                alreadyMonitored: discovered.filter(item => item.alreadyMonitored).length,
                newMonitors: Math.max(afterCount - beforeCount, 0),
                totalMonitors: afterCount
            });
            return {
                preferred,
                beforeCount,
                afterCount,
                discovered
            };
        };
        const refreshCoordinator = RefreshCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug,
            scanForVideos
        });

        return {
            monitor: monitorRegistry.monitor,
            stopMonitoring: monitorRegistry.stopMonitoring,
            scanForVideos,
            refreshVideo: refreshCoordinator.refreshVideo,
            monitorsById,
            getVideoId,
            getMonitoredCount: () => monitorRegistry.getMonitoredCount()
        };
    };

    return { create };
})();
