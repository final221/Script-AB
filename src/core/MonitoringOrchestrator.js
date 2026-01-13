// --- MonitoringOrchestrator ---
/**
 * Sets up monitoring, candidate scoring, and recovery helpers.
 */
const MonitoringOrchestrator = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const isHealing = options.isHealing || (() => false);
        const isFallbackSource = options.isFallbackSource || (() => false);
        let stallHandler = options.onStall || (() => {});

        const monitorRegistry = MonitorRegistry.create({
            logDebug,
            isHealing,
            onStall: (video, details, state) => stallHandler(video, details, state)
        });

        const monitorsById = monitorRegistry.monitorsById;
        const getVideoId = monitorRegistry.getVideoId;

        const candidateSelector = CandidateSelector.create({
            monitorsById,
            getVideoId,
            logDebug,
            maxMonitors: CONFIG.monitoring.MAX_VIDEO_MONITORS,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
            isFallbackSource
        });

        const setStallHandler = (fn) => {
            stallHandler = typeof fn === 'function' ? fn : (() => {});
        };

        const scanForVideos = (reason, detail = {}) => {
            if (!document?.querySelectorAll) {
                return;
            }
            const beforeCount = monitorsById.size;
            const videos = Array.from(document.querySelectorAll('video'));
            Logger.add('[HEALER:SCAN] Video rescan requested', {
                reason,
                found: videos.length,
                ...detail
            });
            for (const video of videos) {
                const videoId = getVideoId(video);
                logDebug('[HEALER:SCAN_ITEM] Video discovered', {
                    reason,
                    videoId,
                    alreadyMonitored: monitorsById.has(videoId),
                    videoState: VideoState.get(video, videoId)
                });
            }
            for (const video of videos) {
                monitorRegistry.monitor(video);
            }
            candidateSelector.evaluateCandidates(`scan_${reason || 'manual'}`);
            candidateSelector.getActiveId();
            const afterCount = monitorsById.size;
            Logger.add('[HEALER:SCAN] Video rescan complete', {
                reason,
                found: videos.length,
                newMonitors: Math.max(afterCount - beforeCount, 0),
                totalMonitors: afterCount
            });
        };

        const recoveryManager = RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            onRescan: scanForVideos
        });
        candidateSelector.setLockChecker(recoveryManager.isFailoverActive);
        monitorRegistry.bind({ candidateSelector, recoveryManager });

        return {
            monitor: monitorRegistry.monitor,
            stopMonitoring: monitorRegistry.stopMonitoring,
            monitorsById,
            getVideoId,
            candidateSelector,
            recoveryManager,
            scanForVideos,
            setStallHandler,
            getMonitoredCount: () => monitorRegistry.getMonitoredCount()
        };
    };

    return { create };
})();
