// --- RecoveryManager ---
// @module RecoveryManager
// @depends RecoveryRefreshController, RecoveryPolicy, FailoverManager, RecoveryContext
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
        const refreshController = RecoveryRefreshController.create({
            monitorsById,
            getVideoId,
            onPersistentFailure,
            onProcessingAssetExhausted: (videoId, atMs, reason) => (
                activateProcessingAssetHardFailureWindow(videoId, reason, atMs)
            )
        });

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
            const context = refreshController.buildContext(videoOrContext, monitorStateOverride, {
                reason: policyReason,
                trigger: reason
            });
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
                const refreshed = refreshController.requestRefresh(context.videoId, context.monitorState, {
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

        const handlePlayFailure = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = refreshController.buildContext(videoOrContext, monitorStateOverride, detail);
            const result = policy.handlePlayFailure(context, detail);
            const now = Date.now();
            if (detail?.errorName === 'PLAY_STUCK'
                && context.monitorState
                && (monitorsById?.size || 0) <= 1) {
                if (context.monitorState.playErrorCount >= CONFIG.stall.PLAY_STUCK_REFRESH_AFTER) {
                    const eligibility = refreshController.evaluateRefreshEligibility(context, {
                        reason: 'play_stuck',
                        now
                    });
                    const refreshed = eligibility.allow && refreshController.requestRefresh(context.videoId, context.monitorState, {
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

            if (!refreshController.shouldTriggerLastResortPageRefresh(
                context,
                detail,
                result,
                failoverAttempted,
                failoverStarted,
                now
            )) {
                return;
            }

            const eligibility = refreshController.evaluateRefreshEligibility(context, {
                reason: 'play_stuck_last_resort',
                trigger: detail.reason || 'play_error',
                now,
                ignoreRefreshCooldown: true
            });
            const refreshed = eligibility.allow && refreshController.requestRefresh(context.videoId, context.monitorState, {
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

        const requestRefresh = refreshController.requestRefresh;
        const canRequestRefresh = refreshController.canRequestRefresh;

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
