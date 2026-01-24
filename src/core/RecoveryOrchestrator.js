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

        const maybeLogResourceWindow = (context, details, now) => {
            const state = context.monitorState;
            if (!state) return;
            if (state.lastResourceWindowLogTime
                && (now - state.lastResourceWindowLogTime) <= CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                return;
            }
            state.lastResourceWindowLogTime = now;
            const stallKey = state.stallStartTime
                || state.lastProgressTime
                || now;
            if (Instrumentation && typeof Instrumentation.logResourceWindow === 'function') {
                Instrumentation.logResourceWindow({
                    videoId: context.videoId,
                    stallTime: now,
                    stallKey,
                    reason: details.trigger || 'stall',
                    stalledFor: details.stalledFor || null
                });
            }
        };

        const shouldDebounceAfterProgress = (context, now) => {
            const state = context.monitorState;
            if (!state) return false;
            const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
            if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                logDebug('[HEALER:DEBOUNCE]', {
                    cooldownMs: CONFIG.stall.RETRY_COOLDOWN_MS,
                    lastHealAttemptAgoMs: now - state.lastHealAttemptTime,
                    state: state.state,
                    videoId: context.videoId
                });
                return true;
            }
            return false;
        };

        const markHealAttempt = (context, now) => {
            if (context.monitorState) {
                context.monitorState.lastHealAttemptTime = now;
            }
        };

        const maybeRescanBufferStarved = (context, now) => {
            const state = context.monitorState;
            if (!state?.bufferStarved) return;
            const lastRescan = state.lastBufferStarveRescanTime || 0;
            if (now - lastRescan < CONFIG.stall.BUFFER_STARVE_RESCAN_COOLDOWN_MS) {
                return;
            }
            state.lastBufferStarveRescanTime = now;
            candidateSelector.activateProbation('buffer_starved');
            const bufferInfo = MediaState.bufferAhead(context.video);
            monitoring.scanForVideos('buffer_starved', {
                videoId: context.videoId,
                bufferAhead: bufferInfo?.bufferAhead ?? null,
                hasBuffer: bufferInfo?.hasBuffer ?? null
            });
        };

        const shouldSkipNonActive = (context, details, now) => {
            const activeCandidateId = candidateSelector.getActiveId();
            if (!activeCandidateId || activeCandidateId === context.videoId) {
                return false;
            }
            if (!context.monitorState?.progressEligible) {
                recoveryManager.probeCandidate(context.videoId, 'stall_non_active');
            }
            const lastLog = stallSkipLogTimes.get(context.videoId) || 0;
            const logIntervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
            if (now - lastLog >= logIntervalMs) {
                stallSkipLogTimes.set(context.videoId, now);
                logDebug('[HEALER:STALL_SKIP] Stall on non-active video', {
                    videoId: context.videoId,
                    activeVideoId: activeCandidateId,
                    stalledFor: details.stalledFor
                });
            }
            return true;
        };

        const logStallDetected = (context, details, now) => {
            const snapshot = context.getSnapshot();
            const summary = LogEvents.summary.stallDetected({
                videoId: context.videoId,
                trigger: details.trigger,
                stalledFor: details.stalledFor,
                bufferExhausted: details.bufferExhausted,
                paused: context.video.paused,
                pauseFromStall: context.monitorState?.pauseFromStall,
                lastProgressAgoMs: context.monitorState ? (now - context.monitorState.lastProgressTime) : null,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered
            });
            Logger.add(summary, {
                ...details,
                lastProgressAgoMs: context.monitorState ? (now - context.monitorState.lastProgressTime) : undefined,
                videoId: context.videoId,
                videoState: snapshot
            });
        };

        const onStallDetected = (video, details = {}, state = null) => {
            const now = Date.now();
            const context = RecoveryContext.create(video, state, getVideoId, {
                trigger: details.trigger,
                reason: details.trigger || 'stall',
                stalledFor: details.stalledFor,
                now
            });

            maybeLogResourceWindow(context, details, now);

            if (recoveryManager.shouldSkipStall(context.videoId, context.monitorState)) {
                return;
            }

            if (shouldDebounceAfterProgress(context, now)) {
                return;
            }
            markHealAttempt(context, now);
            maybeRescanBufferStarved(context, now);

            AdGapSignals.maybeLog({
                video: context.video,
                videoId: context.videoId,
                playheadSeconds: context.video?.currentTime,
                monitorState: context.monitorState,
                now,
                reason: details.trigger || 'stall'
            });

            candidateSelector.evaluateCandidates('stall');
            if (shouldSkipNonActive(context, details, now)) {
                return;
            }

            logStallDetected(context, details, now);

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

