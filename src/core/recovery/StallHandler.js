// --- StallHandler ---
/**
 * Encapsulates stall handling flow (gating, logging, recovery triggers).
 */
const StallHandler = (() => {
    const create = (options = {}) => {
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug || (() => {});
        const healPipeline = options.healPipeline;
        const scanForVideos = options.scanForVideos || (() => {});

        const stallSkipLogTimes = new Map();

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

        const shouldRefreshMissingSource = (context) => {
            const snapshot = context.getLiteLogSnapshot
                ? context.getLiteLogSnapshot()
                : context.getLogSnapshot();
            const hasSrc = Boolean(
                snapshot?.currentSrc
                || snapshot?.src
                || context.video?.currentSrc
                || context.video?.getAttribute?.('src')
            );
            const readyState = snapshot?.readyState ?? context.video?.readyState ?? null;
            const networkState = snapshot?.networkState ?? context.video?.networkState ?? null;
            const buffered = snapshot?.buffered ?? null;
            const noBuffer = buffered === 'none' || buffered === null;
            return !hasSrc && readyState === 0 && networkState === 0 && noBuffer;
        };

        const shouldDebounceAfterProgress = (context, now) => {
            const state = context.monitorState;
            if (!state) return false;
            const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
            if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                logDebug(LogEvents.tagged('DEBOUNCE'), {
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
                PlaybackStateStore.markHealAttempt(context.monitorState, now);
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
            scanForVideos('buffer_starved', {
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
                logDebug(LogEvents.tagged('STALL_SKIP', 'Stall on non-active video'), {
                    videoId: context.videoId,
                    activeVideoId: activeCandidateId,
                    stalledFor: details.stalledFor
                });
            }
            return true;
        };

        const logStallDetected = (context, details, now) => {
            const snapshot = context.getLogSnapshot();
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
            const detail = LogContext.withVideoState({
                ...details,
                lastProgressAgoMs: context.monitorState ? (now - context.monitorState.lastProgressTime) : undefined
            }, snapshot, context.videoId);
            Logger.add(summary, detail);
        };

        const evaluateStallGate = (context, details, now) => {
            if (shouldRefreshMissingSource(context)) {
                const refreshed = recoveryManager.requestRefresh(context.videoId, context.monitorState, {
                    reason: 'no_source',
                    trigger: details.trigger || 'stall',
                    detail: 'no_source'
                });
                if (refreshed) {
                    return { action: 'refresh' };
                }
            }

            if (recoveryManager.shouldSkipStall(context.videoId, context.monitorState)) {
                return { action: 'skip', reason: 'policy_skip' };
            }

            if (shouldDebounceAfterProgress(context, now)) {
                return { action: 'skip', reason: 'debounce' };
            }

            return { action: 'continue' };
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

            const gate = evaluateStallGate(context, details, now);
            if (gate.action !== 'continue') {
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

        return {
            onStallDetected
        };
    };

    return { create };
})();
