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
            const context = RecoveryContext.create(video, state, getVideoId, {
                trigger: details.trigger,
                reason: details.trigger || 'stall',
                stalledFor: details.stalledFor,
                now
            });

            if (state && (!state.lastResourceWindowLogTime
                || (now - state.lastResourceWindowLogTime) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS)) {
                state.lastResourceWindowLogTime = now;
                const stallKey = state.stallStartTime
                    || state.lastProgressTime
                    || now;
                if (Instrumentation && typeof Instrumentation.logResourceWindow === 'function') {
                    Instrumentation.logResourceWindow({
                        videoId,
                        stallTime: now,
                        stallKey,
                        reason: details.trigger || 'stall',
                        stalledFor: details.stalledFor || null
                    });
                }
            }

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

            AdGapSignals.maybeLog({
                video,
                videoId,
                playheadSeconds: video?.currentTime,
                monitorState: state,
                now,
                reason: details.trigger || 'stall'
            });

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

            const snapshot = context.getSnapshot();
            const summary = LogEvents.summary.stallDetected({
                videoId,
                trigger: details.trigger,
                stalledFor: details.stalledFor,
                bufferExhausted: details.bufferExhausted,
                paused: video.paused,
                pauseFromStall: state?.pauseFromStall,
                lastProgressAgoMs: state ? (now - state.lastProgressTime) : null,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered
            });
            Logger.add(summary, {
                ...details,
                lastProgressAgoMs: state ? (now - state.lastProgressTime) : undefined,
                videoId,
                videoState: snapshot
            });

            Metrics.increment('stalls_detected');
            healPipeline.attemptHeal(context);
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

