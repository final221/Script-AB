// --- RecoveryOrchestrator ---
/**
 * Coordinates stall handling, healing, and external signal recovery.
 */
const RecoveryOrchestrator = (() => {
    const create = (options = {}) => {
        const monitoring = options.monitoring;
        const logWithState = options.logWithState;
        const logDebug = options.logDebug || (() => {});

        const monitorsById = monitoring.monitorsById;
        const candidateSelector = monitoring.candidateSelector;
        const recoveryManager = monitoring.recoveryManager;
        const getVideoId = monitoring.getVideoId;

        const stallSkipLogTimes = new Map();

        const healPipeline = HealPipeline.create({
            getVideoId,
            logWithState,
            logDebug,
            recoveryManager,
            onDetached: (video, reason) => {
                monitoring.scanForVideos('detached', {
                    reason,
                    videoId: getVideoId(video)
                });
            }
        });

        const onStallDetected = (video, details = {}, state = null) => {
            const now = Date.now();
            const videoId = getVideoId(video);

            if (recoveryManager.shouldSkipStall(videoId, state)) {
                return;
            }

            if (state) {
                const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
                if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                    logDebug('[HEALER:DEBOUNCE]', {
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

            if (state?.bufferStarved) {
                const lastRescan = state.lastBufferStarveRescanTime || 0;
                if (now - lastRescan >= CONFIG.stall.BUFFER_STARVE_RESCAN_COOLDOWN_MS) {
                    state.lastBufferStarveRescanTime = now;
                    candidateSelector.activateProbation('buffer_starved');
                    const bufferInfo = BufferGapFinder.getBufferAhead(video);
                    monitoring.scanForVideos('buffer_starved', {
                        videoId,
                        bufferAhead: bufferInfo?.bufferAhead ?? null,
                        hasBuffer: bufferInfo?.hasBuffer ?? null
                    });
                }
            }

            candidateSelector.evaluateCandidates('stall');
            const activeCandidateId = candidateSelector.getActiveId();
            if (activeCandidateId && activeCandidateId !== videoId) {
                if (!state?.progressEligible) {
                    recoveryManager.probeCandidate(videoId, 'stall_non_active');
                }
                const lastLog = stallSkipLogTimes.get(videoId) || 0;
                const logIntervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
                if (now - lastLog >= logIntervalMs) {
                    stallSkipLogTimes.set(videoId, now);
                    logDebug('[HEALER:STALL_SKIP] Stall on non-active video', {
                        videoId,
                        activeVideoId: activeCandidateId,
                        stalledFor: details.stalledFor
                    });
                }
                return;
            }

            logWithState('[STALL:DETECTED]', video, {
                ...details,
                lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined,
                videoId
            });

            Metrics.increment('stalls_detected');
            healPipeline.attemptHeal(video, state);
        };

        monitoring.setStallHandler(onStallDetected);

        const externalSignalRouter = ExternalSignalRouter.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug,
            onStallDetected,
            onRescan: (reason, detail) => monitoring.scanForVideos(reason, detail)
        });

        return {
            onStallDetected,
            attemptHeal: (video, state) => healPipeline.attemptHeal(video, state),
            handleExternalSignal: (signal = {}) => externalSignalRouter.handleSignal(signal),
            isHealing: () => healPipeline.isHealing(),
            getAttempts: () => healPipeline.getAttempts()
        };
    };

    return { create };
})();
