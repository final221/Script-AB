// --- RecoveryManager ---
/**
 * Coordinates backoff and failover recovery strategies.
 */
const RecoveryManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});

        const policy = RecoveryPolicy.create({
            logDebug,
            candidateSelector,
            onRescan,
            onPersistentFailure,
            monitorsById,
            getVideoId
        });
        const failoverManager = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            resetBackoff: policy.resetBackoff
        });
        const probeCandidate = failoverManager.probeCandidate;
        const handleNoHealPoint = (videoOrContext, monitorStateOverride, reason) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, { reason });
            const result = policy.handleNoHealPoint(context, reason);
            if (result.emergencySwitched) {
                return;
            }
            if (result.shouldFailover) {
                failoverManager.attemptFailover(context.videoId, reason, context.monitorState);
            }
            if (result.refreshed) {
                return;
            }
        };

        const resetPlayError = policy.resetPlayError;

        const isMissingSource = (context) => {
            const snapshot = context.getLiteLogSnapshot
                ? context.getLiteLogSnapshot()
                : context.getLogSnapshot?.();
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

        const isPlayStuckRefreshReady = (context) => {
            const bufferInfo = MediaState.bufferAhead(context.video);
            const bufferAhead = bufferInfo?.bufferAhead ?? 0;
            const hasBuffer = bufferInfo?.hasBuffer ?? false;
            const readyState = context.video?.readyState ?? null;
            return hasBuffer
                && bufferAhead >= CONFIG.recovery.MIN_HEAL_HEADROOM_S
                && (readyState === null || readyState >= 3);
        };

        const evaluateRefreshEligibility = (context, detail = {}) => {
            const monitorState = context.monitorState;
            if (!monitorState) {
                return { allow: false, reason: 'no_state' };
            }
            const now = Number.isFinite(detail.now) ? detail.now : Date.now();
            const lastRefreshAt = monitorState.lastRefreshAt || 0;
            if (now - lastRefreshAt < CONFIG.stall.REFRESH_COOLDOWN_MS) {
                return {
                    allow: false,
                    reason: 'cooldown',
                    remainingMs: CONFIG.stall.REFRESH_COOLDOWN_MS - (now - lastRefreshAt)
                };
            }
            const reason = detail.reason || context.reason || 'unknown';
            if (reason === 'no_source' && !isMissingSource(context)) {
                return { allow: false, reason: 'no_source_not_ready' };
            }
            if (reason === 'play_stuck' && !isPlayStuckRefreshReady(context)) {
                return { allow: false, reason: 'play_stuck_not_ready' };
            }
            return { allow: true, reason, now };
        };

        const handlePlayFailure = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, detail);
            const result = policy.handlePlayFailure(context, detail);
            if (detail?.errorName === 'PLAY_STUCK'
                && context.monitorState
                && (monitorsById?.size || 0) <= 1) {
                if (context.monitorState.playErrorCount >= CONFIG.stall.PLAY_STUCK_REFRESH_AFTER) {
                    const eligibility = evaluateRefreshEligibility(context, {
                        reason: 'play_stuck'
                    });
                    const refreshed = eligibility.allow && requestRefresh(context.videoId, context.monitorState, {
                        reason: 'play_stuck',
                        trigger: detail.reason || 'play_error',
                        detail: detail.error || 'play_stuck',
                        eligibility
                    });
                    if (refreshed) {
                        return;
                    }
                }
            }
            const shouldConsider = result.probationTriggered || result.repeatStuck || result.shouldFailover;
            if (!shouldConsider) {
                return;
            }
            const beforeActive = candidateSelector.getActiveId();
            candidateSelector.evaluateCandidates('play_error');
            const afterActive = candidateSelector.getActiveId();
            if (result.shouldFailover && afterActive === beforeActive) {
                failoverManager.attemptFailover(context.videoId, detail.reason || 'play_error', context.monitorState);
            }
        };

        const requestRefresh = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, detail);
            const monitorState = context.monitorState;
            if (!monitorState) return false;
            const eligibility = detail.eligibility || evaluateRefreshEligibility(context, detail);
            if (!eligibility.allow) {
                return false;
            }
            PlaybackStateStore.markRefresh(monitorState, eligibility.now);
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video after source loss'), {
                ...RecoveryLogDetails.refresh({
                    videoId: context.videoId,
                    reason: detail.reason || 'source_loss',
                    noHealPointCount: monitorState.noHealPointCount || 0
                }),
                trigger: detail.trigger || null,
                resetType: detail.resetType || null
            });
            onPersistentFailure(context.videoId, {
                reason: detail.reason || 'source_loss',
                detail: detail.detail || 'source_loss'
            });
            return true;
        };

        const canRequestRefresh = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId, detail);
            return evaluateRefreshEligibility(context, detail);
        };

        const shouldSkipStall = (videoId, monitorState) => {
            if (failoverManager.shouldIgnoreStall(videoId)) {
                return true;
            }
            const context = RecoveryContext.create(
                monitorsById?.get(videoId)?.video || null,
                monitorState,
                getVideoId,
                { videoId }
            );
            return policy.shouldSkipStall(context);
        };

        return {
            isFailoverActive: () => failoverManager.isActive(),
            resetFailover: failoverManager.resetFailover,
            resetBackoff: policy.resetBackoff,
            resetPlayError,
            handleNoHealPoint,
            handlePlayFailure,
            requestRefresh,
            canRequestRefresh,
            shouldSkipStall,
            probeCandidate,
            onMonitorRemoved: failoverManager.onMonitorRemoved
        };
    };

    return { create };
})();
