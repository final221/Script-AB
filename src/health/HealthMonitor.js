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

    // State tracking
    let isPaused = false;
    let lastTriggerTime = 0;
    const COOLDOWN_MS = 5000; // 5 seconds
    let pendingIssues = [];

    const triggerRecovery = (reason, details, triggerType) => {
        // Cooldown check
        const now = Date.now();
        if (now - lastTriggerTime < COOLDOWN_MS) {
            Logger.add('[HEALTH] Trigger skipped - cooldown active', {
                timeSinceLast: (now - lastTriggerTime) / 1000
            });
            return;
        }

        Logger.add(`[HEALTH] Recovery trigger | Reason: ${reason}, Type: ${triggerType}`, details);
        Metrics.increment('health_triggers');

        lastTriggerTime = now;
        HealthMonitor.pause(); // Pause instead of stop

        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
            source: 'HEALTH',
            trigger: triggerType,
            reason: reason,
            details: details
        });
    };

    const runMainChecks = () => {
        if (!videoRef || !document.body.contains(videoRef) || isPaused) {
            return;
        }

        // Accumulate all issues
        const stuckResult = StuckDetector.check(videoRef);
        if (stuckResult) {
            pendingIssues.push({ type: 'STUCK_PLAYBACK', priority: 3, ...stuckResult });
        }

        const frameDropResult = FrameDropDetector.check(videoRef);
        if (frameDropResult) {
            pendingIssues.push({ type: 'FRAME_DROP', priority: 2, ...frameDropResult });
        }

        // Process issues if any found
        if (pendingIssues.length > 0) {
            // Sort by priority (highest first)
            pendingIssues.sort((a, b) => b.priority - a.priority);

            const topIssue = pendingIssues[0];
            if (pendingIssues.length > 1) {
                Logger.add('[HEALTH] Multiple issues detected, triggering for highest priority', {
                    allIssues: pendingIssues.map(i => i.type),
                    selected: topIssue.type
                });
            }

            triggerRecovery(topIssue.reason, topIssue.details, topIssue.type);
            pendingIssues = []; // Clear
        }
    };

    const runSyncCheck = () => {
        if (!videoRef || !document.body.contains(videoRef) || isPaused) {
            return;
        }

        // Check A/V sync
        const syncResult = AVSyncDetector.check(videoRef);
        if (syncResult) {
            pendingIssues.push({ type: 'AV_SYNC', priority: 1, ...syncResult });

            // A/V sync is lowest priority - only trigger if no other issues pending
            // We use a small timeout to allow main checks to run if they happen simultaneously
            setTimeout(() => {
                if (pendingIssues.some(i => i.type === 'AV_SYNC') && !isPaused) {
                    const avIssue = pendingIssues.find(i => i.type === 'AV_SYNC');
                    triggerRecovery(avIssue.reason, avIssue.details, 'AV_SYNC');
                    pendingIssues = [];
                }
            }, 100);
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

            // Auto-resume on recovery completion
            Adapters.EventBus.on(CONFIG.events.REPORT, (payload) => {
                if (payload.status === 'SUCCESS' || payload.status === 'FAILED') {
                    Logger.add('[HEALTH] Recovery completed, resuming monitoring');
                    HealthMonitor.resume();
                }
            });
        },

        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            videoRef = null;
            isPaused = false;
            lastTriggerTime = 0; // Reset cooldown
            StuckDetector.reset();
            FrameDropDetector.reset();
            AVSyncDetector.reset();
        },

        pause: () => {
            if (isPaused) return;

            Logger.add('[HEALTH] Monitoring paused');
            isPaused = true;

            // Auto-resume after timeout as safety net
            setTimeout(() => {
                if (isPaused) {
                    Logger.add('[HEALTH] Auto-resuming after recovery timeout');
                    HealthMonitor.resume();
                }
            }, 15000);
        },

        resume: () => {
            if (!isPaused) return;

            Logger.add('[HEALTH] Monitoring resumed');
            isPaused = false;

            if (videoRef) {
                StuckDetector.reset(videoRef);
                FrameDropDetector.reset();
                AVSyncDetector.reset(videoRef);
            }
        }
    };
})();
