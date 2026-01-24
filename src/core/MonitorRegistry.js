// --- MonitorRegistry ---
/**
 * Tracks monitored videos and coordinates playback monitoring lifecycle.
 */
const MonitorRegistry = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const isHealing = options.isHealing || (() => false);
        const onStall = options.onStall || (() => {});

        const monitoredVideos = new WeakMap();
        const monitorsById = new Map();
        const videoIds = new WeakMap();
        let nextVideoId = 1;
        let monitoredCount = 0;
        let candidateIntervalId = null;
        let candidateSelector = null;
        let recoveryManager = null;

        const bind = (handlers = {}) => {
            candidateSelector = handlers.candidateSelector || null;
            recoveryManager = handlers.recoveryManager || null;
        };

        const getVideoId = (video) => {
            let id = videoIds.get(video);
            if (!id) {
                id = `video-${nextVideoId++}`;
                videoIds.set(video, id);
            }
            return id;
        };

        const startCandidateEvaluation = () => {
            if (candidateIntervalId || !candidateSelector) return;
            candidateIntervalId = setInterval(() => {
                candidateSelector.evaluateCandidates('interval');
            }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stopCandidateEvaluationIfIdle = () => {
            if (monitorsById.size === 0 && candidateIntervalId) {
                clearInterval(candidateIntervalId);
                candidateIntervalId = null;
                if (candidateSelector) {
                    candidateSelector.setActiveId(null);
                }
            }
        };

        const stopMonitoring = (video) => {
            const monitor = monitoredVideos.get(video);
            if (!monitor) return;

            monitor.stop();
            monitoredVideos.delete(video);
            const videoId = getVideoId(video);
            monitorsById.delete(videoId);
            monitoredCount--;
            if (recoveryManager) {
                recoveryManager.onMonitorRemoved(videoId);
            }
            if (candidateSelector && candidateSelector.getActiveId() === videoId) {
                candidateSelector.setActiveId(null);
                if (monitorsById.size > 0) {
                    candidateSelector.evaluateCandidates('removed');
                }
            }
            stopCandidateEvaluationIfIdle();
            Logger.add('[HEALER:STOP] Stopped monitoring video', {
                remainingMonitors: monitoredCount,
                videoId
            });
        };

        const resetVideoId = (video) => {
            if (!video) return;
            videoIds.delete(video);
        };

        const monitor = (video) => {
            if (!video) return;

            if (!candidateSelector) {
                logDebug('[HEALER:SKIP] Candidate selector not ready');
                return;
            }

            if (monitoredVideos.has(video)) {
                logDebug('[HEALER:SKIP] Video already being monitored');
                return;
            }

            const videoId = getVideoId(video);
            Logger.add('[HEALER:VIDEO] Video registered', {
                videoId,
                videoState: VideoState.getLog(video, videoId)
            });

            const monitor = PlaybackMonitor.create(video, {
                isHealing,
                isActive: () => candidateSelector.getActiveId() === videoId,
                onRemoved: () => stopMonitoring(video),
                onStall: (details, state) => onStall(video, details, state),
                onReset: (details) => {
                    Logger.add('[HEALER:RESET] Video reset detected', {
                        videoId,
                        ...details
                    });
                    candidateSelector.evaluateCandidates('reset');
                },
                videoId
            });

            monitor.start();

            monitoredVideos.set(video, monitor);
            monitorsById.set(videoId, { video, monitor });
            monitoredCount++;
            startCandidateEvaluation();
            candidateSelector.pruneMonitors(videoId, stopMonitoring);
            candidateSelector.evaluateCandidates('register');

            Logger.add('[HEALER:MONITOR] Started monitoring video', {
                videoId,
                debug: CONFIG.debug,
                checkInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
                totalMonitors: monitoredCount
            });
        };

        return {
            monitor,
            stopMonitoring,
            resetVideoId,
            getVideoId,
            bind,
            monitorsById,
            getMonitoredCount: () => monitoredCount
        };
    };

    return { create };
})();
