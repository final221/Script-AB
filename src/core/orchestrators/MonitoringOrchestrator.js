// --- MonitoringOrchestrator ---
/**
 * Sets up monitoring, candidate scoring, and recovery helpers.
 * Inputs: logDebug/isHealing/isFallbackSource callbacks, onStall handler.
 * Outputs: monitor lifecycle methods + candidateSelector/recoveryManager wiring.
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

        const coordinator = MonitorCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug
        });

        const recoveryManager = RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            onRescan: coordinator.scanForVideos,
            onPersistentFailure: (videoId, detail = {}) => coordinator.refreshVideo(videoId, detail)
        });
        candidateSelector.setLockChecker(recoveryManager.isFailoverActive);
        monitorRegistry.bind({ candidateSelector, recoveryManager });

        return {
            monitor: coordinator.monitor,
            stopMonitoring: coordinator.stopMonitoring,
            monitorsById,
            getVideoId,
            candidateSelector,
            recoveryManager,
            scanForVideos: coordinator.scanForVideos,
            setStallHandler,
            getMonitoredCount: () => coordinator.getMonitoredCount()
        };
    };

    return { create };
})();
