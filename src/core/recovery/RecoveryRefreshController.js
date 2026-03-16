// --- RecoveryRefreshController ---
// @module RecoveryRefreshController
// @depends FailoverManager
/**
 * Handles refresh eligibility checks, refresh execution, and recovery context normalization.
 */
const RecoveryRefreshController = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const onProcessingAssetExhausted = options.onProcessingAssetExhausted || (() => {});
        const refreshAtByVideo = new WeakMap();

        const normalizeVideoInput = (videoOrContext, monitorStateOverride, detail = {}) => {
            if (videoOrContext && typeof videoOrContext === 'object' && videoOrContext.video) {
                return { videoOrContext, monitorStateOverride, detail };
            }
            if (typeof videoOrContext === 'string') {
                const entry = monitorsById?.get(videoOrContext);
                return {
                    videoOrContext: entry?.video || null,
                    monitorStateOverride: monitorStateOverride || entry?.monitor?.state || null,
                    detail: { ...detail, videoId: videoOrContext }
                };
            }
            return { videoOrContext, monitorStateOverride, detail };
        };

        const buildContext = (videoOrContext, monitorStateOverride, detail = {}) => {
            const normalized = normalizeVideoInput(videoOrContext, monitorStateOverride, detail);
            return RecoveryContext.from(
                normalized.videoOrContext,
                normalized.monitorStateOverride,
                getVideoId,
                normalized.detail
            );
        };

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
            const monitorRefreshAt = monitorState.lastRefreshAt || 0;
            const hasElementRefresh = Boolean(context.video) && refreshAtByVideo.has(context.video);
            const elementRefreshAt = hasElementRefresh ? refreshAtByVideo.get(context.video) : null;
            const lastRefreshAt = hasElementRefresh
                ? Math.max(monitorRefreshAt, elementRefreshAt || 0)
                : monitorRefreshAt;
            const ignoreRefreshCooldown = Boolean(detail.ignoreRefreshCooldown);
            if (!ignoreRefreshCooldown
                && lastRefreshAt > 0
                && now - lastRefreshAt < CONFIG.stall.REFRESH_COOLDOWN_MS) {
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

        const requestRefresh = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = buildContext(videoOrContext, monitorStateOverride, detail);
            const monitorState = context.monitorState;
            if (!monitorState) return false;

            const eligibility = detail.eligibility || evaluateRefreshEligibility(context, detail);
            if (!eligibility.allow) return false;

            PlaybackStateStore.markRefresh(monitorState, eligibility.now);
            if (context.video) {
                refreshAtByVideo.set(context.video, eligibility.now);
            }
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video after source loss'), {
                ...RecoveryLogDetails.refresh({
                    videoId: context.videoId,
                    reason: detail.reason || 'source_loss',
                    noHealPointCount: monitorState.noHealPointCount || 0
                }),
                trigger: detail.trigger || null,
                resetType: detail.resetType || null,
                forcePageRefresh: Boolean(detail.forcePageRefresh)
            });
            onPersistentFailure(context.videoId, {
                reason: detail.reason || 'source_loss',
                detail: detail.detail || 'source_loss',
                forcePageRefresh: Boolean(detail.forcePageRefresh)
            });
            if (detail.reason === 'processing_asset_exhausted') {
                onProcessingAssetExhausted(context.videoId, eligibility.now || Date.now(), detail.reason);
            }
            return true;
        };

        const canRequestRefresh = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = buildContext(videoOrContext, monitorStateOverride, detail);
            return evaluateRefreshEligibility(context, detail);
        };

        const shouldTriggerLastResortPageRefresh = (
            context,
            detail,
            result,
            failoverAttempted,
            failoverStarted,
            now
        ) => {
            if (!context.monitorState) return false;
            if (detail?.errorName !== 'PLAY_STUCK') return false;
            if (!result?.shouldFailover) return false;
            if (!failoverAttempted || failoverStarted) return false;

            const playErrorCount = context.monitorState.playErrorCount || 0;
            if (playErrorCount < CONFIG.stall.PLAY_STUCK_LAST_RESORT_PAGE_REFRESH_AFTER) {
                return false;
            }

            const lastProgressTime = context.monitorState.lastProgressTime || 0;
            const stalledForMs = lastProgressTime ? (now - lastProgressTime) : null;
            const minStallMs = CONFIG.stall.PLAY_STUCK_LAST_RESORT_MIN_STALL_MS || 0;
            if (stalledForMs !== null && stalledForMs < minStallMs) return false;
            return true;
        };

        return {
            buildContext,
            requestRefresh,
            canRequestRefresh,
            evaluateRefreshEligibility,
            shouldTriggerLastResortPageRefresh
        };
    };

    return { create };
})();
