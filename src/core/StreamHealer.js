// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;

    const LOG = {
        DEBOUNCE: '[HEALER:DEBOUNCE]',
        STALL_DETECTED: '[STALL:DETECTED]'
    };

    const logDebug = (message, detail) => {
        if (CONFIG.debug) {
            Logger.add(message, detail);
        }
    };

    let healPipeline = null;
    let onStallDetected = null;

    const monitorRegistry = MonitorRegistry.create({
        logDebug,
        isHealing: () => (healPipeline ? healPipeline.isHealing() : false),
        onStall: (video, details, state) => {
            if (onStallDetected) {
                onStallDetected(video, details, state);
            }
        }
    });

    const monitorsById = monitorRegistry.monitorsById;
    const getVideoId = monitorRegistry.getVideoId;

    const logWithState = (message, video, detail = {}) => {
        Logger.add(message, {
            ...detail,
            videoState: VideoState.get(video, getVideoId(video))
        });
    };

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);
    const candidateSelector = CandidateSelector.create({
        monitorsById,
        getVideoId,
        logDebug,
        maxMonitors: CONFIG.monitoring.MAX_VIDEO_MONITORS,
        minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
        switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
        isFallbackSource
    });
    const recoveryManager = RecoveryManager.create({
        monitorsById,
        candidateSelector,
        getVideoId,
        logDebug
    });
    candidateSelector.setLockChecker(recoveryManager.isFailoverActive);
    monitorRegistry.bind({ candidateSelector, recoveryManager });

    healPipeline = HealPipeline.create({
        getVideoId,
        logWithState,
        logDebug,
        recoveryManager
    });

    onStallDetected = (video, details = {}, state = null) => {
        const now = Date.now();
        const videoId = getVideoId(video);

        if (recoveryManager.shouldSkipStall(videoId, state)) {
            return;
        }

        if (state) {
            const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
            if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                logDebug(LOG.DEBOUNCE, {
                    cooldownMs: CONFIG.stall.RETRY_COOLDOWN_MS,
                    lastHealAttemptAgoMs: now - state.lastHealAttemptTime,
                    state: state.state,
                    videoId
                });
                return;
            }
        }
        if (state) {
            state.lastHealAttemptTime = now;
        }

        candidateSelector.evaluateCandidates('stall');
        const activeCandidateId = candidateSelector.getActiveId();
        if (activeCandidateId && activeCandidateId !== videoId) {
            logDebug('[HEALER:STALL_SKIP] Stall on non-active video', {
                videoId,
                activeVideoId: activeCandidateId,
                stalledFor: details.stalledFor
            });
            return;
        }

        logWithState(LOG.STALL_DETECTED, video, {
            ...details,
            lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined,
            videoId
        });

        Metrics.increment('stalls_detected');
        healPipeline.attemptHeal(video, state);
    };
    const externalSignalRouter = ExternalSignalRouter.create({
        monitorsById,
        candidateSelector,
        recoveryManager,
        logDebug,
        onStallDetected
    });

    const handleExternalSignal = (signal = {}) => {
        externalSignalRouter.handleSignal(signal);
    };

    return {
        monitor: monitorRegistry.monitor,
        stopMonitoring: monitorRegistry.stopMonitoring,
        onStallDetected,
        attemptHeal: (video, state) => healPipeline.attemptHeal(video, state),
        handleExternalSignal,
        getStats: () => ({
            healAttempts: healPipeline.getAttempts(),
            isHealing: healPipeline.isHealing(),
            monitoredCount: monitorRegistry.getMonitoredCount()
        })
    };
})();
