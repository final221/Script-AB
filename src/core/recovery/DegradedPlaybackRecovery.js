// @module DegradedPlaybackRecovery
// @depends RecoveryRefreshController, CatchUpController, PlaybackStateStore
/**
 * Escalates severe degraded playback when no better candidate exists.
 */
const DegradedPlaybackRecovery = (() => {
    const create = (options = {}) => {
        const refreshController = options.refreshController;
        const candidateSelector = options.candidateSelector;
        const catchUpController = CatchUpController.create();

        const handleDegradedPlayback = (videoOrContext, monitorStateOverride, detail = {}) => {
            const context = refreshController.buildContext(videoOrContext, monitorStateOverride, {
                reason: 'degraded_sync',
                trigger: detail.trigger || 'sync'
            });
            if (!context.monitorState) return false;

            const activeBefore = candidateSelector.getActiveId?.() || null;
            if (activeBefore && activeBefore !== context.videoId) {
                return false;
            }

            candidateSelector.evaluateCandidates?.('degraded_sync');
            const activeAfter = candidateSelector.getActiveId?.() || null;
            if (activeAfter && activeAfter !== context.videoId) {
                return false;
            }

            const severe = Boolean(detail.severe);
            const hasRecentPlayError = (context.monitorState.playErrorCount || 0) > 0;
            const awaitingNoHealRecovery = Boolean(context.monitorState.pendingNoHealRecoveryCheck);
            const bufferEndDeltaS = Number.isFinite(detail.bufferEndDeltaS) ? detail.bufferEndDeltaS : null;
            const bufferedEnough = bufferEndDeltaS === null
                || bufferEndDeltaS >= CONFIG.recovery.MIN_HEAL_HEADROOM_S;
            if (awaitingNoHealRecovery && severe) {
                const catchUpScheduledAt = context.monitorState.noHealRecoveryCatchUpScheduledAt || 0;
                if (!catchUpScheduledAt) {
                    const now = Date.now();
                    PlaybackStateStore.markNoHealRecoveryCatchUpScheduled(context.monitorState, now);
                    Logger.add(LogEvents.tagged('CATCH_UP', 'Post-no-heal degraded playback routed to catch-up'), {
                        videoId: context.videoId,
                        rate: Number.isFinite(detail.rate) ? detail.rate.toFixed(3) : null,
                        driftMs: detail.driftMs ?? null,
                        bufferEndDelta: bufferEndDeltaS !== null ? bufferEndDeltaS.toFixed(2) + 's' : null,
                        activeBefore,
                        activeAfter
                    });
                    catchUpController.scheduleCatchUp(
                        context.video,
                        context.monitorState,
                        context.videoId,
                        'post_no_heal'
                    );
                }
                return true;
            }
            if (!severe || !hasRecentPlayError || !bufferedEnough) {
                return false;
            }

            const now = Date.now();
            const eligibility = refreshController.evaluateRefreshEligibility(context, {
                reason: 'post_heal_degraded',
                trigger: detail.trigger || 'sync',
                now
            });
            const refreshed = eligibility.allow && refreshController.requestRefresh(
                context.videoId,
                context.monitorState,
                {
                    reason: 'post_heal_degraded',
                    trigger: detail.trigger || 'sync',
                    detail: 'severe_post_heal_sync_collapse',
                    forcePageRefresh: true,
                    eligibility
                }
            );

            Logger.add(LogEvents.tagged('REFRESH', 'Post-heal degraded playback escalation applied'), {
                videoId: context.videoId,
                severe,
                playErrorCount: context.monitorState.playErrorCount || 0,
                rate: Number.isFinite(detail.rate) ? detail.rate.toFixed(3) : null,
                driftMs: detail.driftMs ?? null,
                bufferEndDelta: bufferEndDeltaS !== null ? bufferEndDeltaS.toFixed(2) + 's' : null,
                activeBefore,
                activeAfter,
                refreshEligible: eligibility.allow,
                refreshEligibilityReason: eligibility.reason || null,
                refreshed
            });

            return refreshed;
        };

        return {
            handleDegradedPlayback
        };
    };

    return { create };
})();
