// --- Health Monitor ---
/**
 * Orchestrates health monitoring by coordinating detector modules.
 * @responsibility
 * 1. Manage timers for health checks.
 * 2. Coordinate detectors (Stuck, FrameDrop, AVSync).
 * 3. Trigger recovery when issues are detected.
 */
const HealthMonitor = (() => {
    let videoRef = null;
    const timers = { main: null, sync: null };

    const triggerRecovery = (reason, details, triggerType) => {
        Logger.add(`[HEALTH] Recovery trigger | Reason: ${reason}, Type: ${triggerType}`, details);
        Metrics.increment('health_triggers');
        HealthMonitor.stop();
        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
            source: 'HEALTH',
            trigger: triggerType,
            reason: reason,
            details: details
        });
    };

    const runMainChecks = () => {
        if (!videoRef || !document.body.contains(videoRef)) {
            HealthMonitor.stop();
            return;
        }

        // Check for stuck playback
        const stuckResult = StuckDetector.check(videoRef);
        if (stuckResult) {
            triggerRecovery(stuckResult.reason, stuckResult.details, 'STUCK_PLAYBACK');
            return;
        }

        // Check for frame drops
        const frameDropResult = FrameDropDetector.check(videoRef);
        if (frameDropResult) {
            triggerRecovery(frameDropResult.reason, frameDropResult.details, 'FRAME_DROP');
            return;
        }
    };

    const runSyncCheck = () => {
        if (!videoRef || !document.body.contains(videoRef)) {
            HealthMonitor.stop();
            return;
        }

        // Check A/V sync
        const syncResult = AVSyncDetector.check(videoRef);
        if (syncResult) {
            triggerRecovery(syncResult.reason, syncResult.details, 'AV_SYNC');
            return;
        }
    };

    return {
        start: (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            if (videoRef !== video) {
                HealthMonitor.stop();
                videoRef = video;
                StuckDetector.reset(video);
                FrameDropDetector.reset();
                AVSyncDetector.reset(video);
            }

            if (!timers.main) {
                timers.main = setInterval(runMainChecks, CONFIG.timing.HEALTH_CHECK_MS);
            }

            if (!timers.sync) {
                timers.sync = setInterval(runSyncCheck, CONFIG.timing.AV_SYNC_CHECK_INTERVAL_MS);
            }
        },
        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            videoRef = null;
            StuckDetector.reset();
            FrameDropDetector.reset();
            AVSyncDetector.reset();
        },
    };
})();
