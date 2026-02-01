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

        const gateRefreshMissingSource = (context, details) => {
            const eligibility = recoveryManager.canRequestRefresh(context, null, {
                reason: 'no_source',
                trigger: details.trigger || 'stall',
                detail: 'no_source'
            });
            if (!eligibility.allow) return null;
            const refreshed = recoveryManager.requestRefresh(context.videoId, context.monitorState, {
                reason: 'no_source',
                trigger: details.trigger || 'stall',
                detail: 'no_source',
                eligibility
            });
            return refreshed ? { action: 'refresh', reason: 'no_source' } : null;
        };

        const gatePolicySkip = (context) => (
            recoveryManager.shouldSkipStall(context.videoId, context.monitorState)
                ? { action: 'skip', reason: 'policy_skip' }
                : null
        );

        const gateDebounceAfterProgress = (context, now) => (
            shouldDebounceAfterProgress(context, now)
                ? { action: 'skip', reason: 'debounce' }
                : null
        );

        const runStallPipeline = (steps, context, details, now) => {
            for (const step of steps) {
                const result = step(context, details, now);
                if (result && result.action && result.action !== 'continue') {
                    return result;
                }
            }
            return { action: 'continue' };
        };

        const stallPipeline = [
            (ctx, ctxDetails) => gateRefreshMissingSource(ctx, ctxDetails),
            (ctx) => gatePolicySkip(ctx),
            (ctx, ctxDetails, ctxNow) => gateDebounceAfterProgress(ctx, ctxNow),
            (ctx, ctxDetails, ctxNow) => {
                markHealAttempt(ctx, ctxNow);
                return null;
            },
            (ctx, ctxDetails, ctxNow) => {
                maybeRescanBufferStarved(ctx, ctxNow);
                return null;
            },
            (ctx, ctxDetails, ctxNow) => {
                AdGapSignals.maybeLog({
                    video: ctx.video,
                    videoId: ctx.videoId,
                    playheadSeconds: ctx.video?.currentTime,
                    monitorState: ctx.monitorState,
                    now: ctxNow,
                    reason: ctxDetails.trigger || 'stall'
                });
                return null;
            },
            (ctx) => {
                candidateSelector.evaluateCandidates('stall');
                return null;
            },
            (ctx, ctxDetails, ctxNow) => (
                shouldSkipNonActive(ctx, ctxDetails, ctxNow)
                    ? { action: 'skip', reason: 'non_active' }
                    : null
            ),
            (ctx, ctxDetails, ctxNow) => {
                logStallDetected(ctx, ctxDetails, ctxNow);
                return null;
            },
            (ctx) => {
                Metrics.increment('stalls_detected');
                healPipeline.attemptHeal(ctx);
                return { action: 'handled' };
            }
        ];

        const onStallDetected = (video, details = {}, state = null) => {
            const now = Date.now();
            const context = RecoveryContext.create(video, state, getVideoId, {
                trigger: details.trigger,
                reason: details.trigger || 'stall',
                stalledFor: details.stalledFor,
                now
            });

            maybeLogResourceWindow(context, details, now);

            runStallPipeline(stallPipeline, context, details, now);
        };

        return {
            onStallDetected
        };
    };

    return { create };
})();
