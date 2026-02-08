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
        const hardFailureWindowMs = CONFIG.stall.PROCESSING_ASSET_HARD_FAILURE_WINDOW_MS || 0;
        let processingAssetHardFailureUntil = 0;
        let lastHardFailureLogTime = 0;

        const isProcessingAssetHardFailureActive = (now = Date.now()) => (
            hardFailureWindowMs > 0
            && processingAssetHardFailureUntil
            && now < processingAssetHardFailureUntil
        );

        const activateProcessingAssetHardFailureWindow = (videoId, reason, now = Date.now()) => {
            if (hardFailureWindowMs <= 0) return;
            processingAssetHardFailureUntil = now + hardFailureWindowMs;
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing asset hard-failure window activated'), {
                videoId,
                reason,
                windowMs: hardFailureWindowMs,
                activeUntilMs: processingAssetHardFailureUntil
            });
        };

        const normalizeVideoInput = (videoOrContext, monitorStateOverride, detail = {}) => {
            if (videoOrContext && typeof videoOrContext === 'object' && videoOrContext.video) {
                return { videoOrContext, monitorStateOverride, detail };
            }
            if (typeof videoOrContext === 'string') {
                const entry = monitorsById?.get(videoOrContext);
                const nextDetail = { ...detail, videoId: videoOrContext };
                return {
                    videoOrContext: entry?.video || null,
                    monitorStateOverride: monitorStateOverride || entry?.monitor?.state || null,
                    detail: nextDetail
                };
            }
            return { videoOrContext, monitorStateOverride, detail };
        };
        const handleNoHealPoint = (videoOrContext, monitorStateOverride, reason) => {
            const now = Date.now();
            const hardFailureMode = isProcessingAssetHardFailureActive(now);
            const policyReason = hardFailureMode ? 'processing_asset_hard_failure' : reason;
            if (hardFailureMode && (now - lastHardFailureLogTime) >= CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing asset hard-failure mode active'), {
                    reason,
                    policyReason,
                    remainingMs: Math.max(processingAssetHardFailureUntil - now, 0)
                });
                lastHardFailureLogTime = now;
            }
            const normalized = normalizeVideoInput(videoOrContext, monitorStateOverride, {
                reason: policyReason,
                trigger: reason
            });
            const context = RecoveryContext.from(
                normalized.videoOrContext,
                normalized.monitorStateOverride,
                getVideoId,
                normalized.detail
            );
            const result = policy.handleNoHealPoint(context, policyReason);
            const failoverEligible = Boolean(result?.failoverEligible ?? result?.shouldFailover);
            const refreshEligible = Boolean(result?.refreshEligible);
            const primaryAction = result?.primaryAction
                || (failoverEligible ? 'failover' : (refreshEligible ? 'refresh' : 'none'));
            Logger.add(LogEvents.tagged('BACKOFF', 'No-heal action selected'), {
                videoId: context.videoId,
                reason: policyReason,
                trigger: reason,
                primaryAction,
                failoverEligible,
                refreshEligible
            });

            const tryRefreshFallback = () => {
                if (!refreshEligible) return false;
                const refreshed = requestRefresh(context.videoId, context.monitorState, {
                    reason: 'no_heal_point',
                    trigger: policyReason,
                    detail: 'no_heal_point'
                });
                Logger.add(LogEvents.tagged('REFRESH', 'No-heal refresh applied'), {
                    videoId: context.videoId,
                    reason: policyReason,
                    trigger: reason,
                    refreshed
                });
                return refreshed;
            };

            if (primaryAction === 'failover' && failoverEligible) {
                const failoverStarted = failoverManager.attemptFailover(context.videoId, policyReason, context.monitorState);
                if (failoverStarted) {
                    return;
                }
                if (refreshEligible) {
                    Logger.add(LogEvents.tagged('REFRESH', 'No-heal fallback: refresh after failover unavailable'), {
                        videoId: context.videoId,
                        reason: policyReason,
                        trigger: reason
                    });
                }
                tryRefreshFallback();
                return;
            }

            if (primaryAction === 'refresh' || refreshEligible) {
                tryRefreshFallback();
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
            const ignoreRefreshCooldown = Boolean(detail.ignoreRefreshCooldown);
            if (!ignoreRefreshCooldown && now - lastRefreshAt < CONFIG.stall.REFRESH_COOLDOWN_MS) {
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
            if (stalledForMs !== null && stalledForMs < minStallMs) {
                return false;
            }

            return true;
        };

        const handlePlayFailure = (videoOrContext, monitorStateOverride, detail = {}) => {
            const normalized = normalizeVideoInput(videoOrContext, monitorStateOverride, detail);
            const context = RecoveryContext.from(
                normalized.videoOrContext,
                normalized.monitorStateOverride,
                getVideoId,
                normalized.detail
            );
            const result = policy.handlePlayFailure(context, detail);
            const now = Date.now();
            if (detail?.errorName === 'PLAY_STUCK'
                && context.monitorState
                && (monitorsById?.size || 0) <= 1) {
                if (context.monitorState.playErrorCount >= CONFIG.stall.PLAY_STUCK_REFRESH_AFTER) {
                    const eligibility = evaluateRefreshEligibility(context, {
                        reason: 'play_stuck',
                        now
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
            let failoverAttempted = false;
            let failoverStarted = false;
            if (result.shouldFailover && afterActive === beforeActive) {
                failoverAttempted = true;
                failoverStarted = failoverManager.attemptFailover(
                    context.videoId,
                    detail.reason || 'play_error',
                    context.monitorState
                );
            }

            if (!shouldTriggerLastResortPageRefresh(
                context,
                detail,
                result,
                failoverAttempted,
                failoverStarted,
                now
            )) {
                return;
            }

            const eligibility = evaluateRefreshEligibility(context, {
                reason: 'play_stuck_last_resort',
                trigger: detail.reason || 'play_error',
                now,
                ignoreRefreshCooldown: true
            });
            const refreshed = eligibility.allow && requestRefresh(context.videoId, context.monitorState, {
                reason: 'play_stuck_last_resort',
                trigger: detail.reason || 'play_error',
                detail: 'persistent_play_stuck_no_failover',
                forcePageRefresh: true,
                ignoreRefreshCooldown: true,
                eligibility
            });
            Logger.add(LogEvents.tagged('REFRESH', 'Last-resort page refresh decision applied'), {
                videoId: context.videoId,
                reason: detail.reason || 'play_error',
                playErrorCount: context.monitorState?.playErrorCount || 0,
                failoverAttempted,
                failoverStarted,
                refreshEligible: eligibility.allow,
                refreshEligibilityReason: eligibility.reason || null,
                refreshed
            });
        };

        const requestRefresh = (videoOrContext, monitorStateOverride, detail = {}) => {
            const normalized = normalizeVideoInput(videoOrContext, monitorStateOverride, detail);
            const context = RecoveryContext.from(
                normalized.videoOrContext,
                normalized.monitorStateOverride,
                getVideoId,
                normalized.detail
            );
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
                resetType: detail.resetType || null,
                forcePageRefresh: Boolean(detail.forcePageRefresh)
            });
            onPersistentFailure(context.videoId, {
                reason: detail.reason || 'source_loss',
                detail: detail.detail || 'source_loss',
                forcePageRefresh: Boolean(detail.forcePageRefresh)
            });
            if (detail.reason === 'processing_asset_exhausted') {
                activateProcessingAssetHardFailureWindow(
                    context.videoId,
                    detail.reason,
                    eligibility.now || Date.now()
                );
            }
            return true;
        };

        const canRequestRefresh = (videoOrContext, monitorStateOverride, detail = {}) => {
            const normalized = normalizeVideoInput(videoOrContext, monitorStateOverride, detail);
            const context = RecoveryContext.from(
                normalized.videoOrContext,
                normalized.monitorStateOverride,
                getVideoId,
                normalized.detail
            );
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
