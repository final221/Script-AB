// --- HealPipeline ---
/**
 * Handles heal-point polling and seek recovery.
 */
const HealPipeline = (() => {
    const create = (options) => {
        const getVideoId = options.getVideoId;
        const logWithState = options.logWithState;
        const recoveryManager = options.recoveryManager;
        const onDetached = options.onDetached || (() => {});
        const poller = HealPointPoller.create({
            getVideoId,
            logWithState,
            logDebug: options.logDebug,
            shouldAbort: (video) => (!document.contains(video) ? 'detached' : false)
        });
        const catchUpController = CatchUpController.create();
        const attemptLogger = HealAttemptLogger.create();
        const state = { isHealing: false, healAttempts: 0 };
        const OutcomeStatus = { FOUND: 'found', RECOVERED: 'recovered', NO_POINT: 'no_point', ABORTED: 'aborted', FAILED: 'failed' };
        const getDurationMs = (startTime) => Number((performance.now() - startTime).toFixed(0));
        const resetRecovery = (monitorState, reason) => {
            recoveryManager.resetBackoff(monitorState, reason);
            if (recoveryManager.resetPlayError) {
                recoveryManager.resetPlayError(monitorState, reason);
            }
        };
        const resetHealPointTracking = (monitorState) => {
            if (!monitorState) return;
            monitorState.lastHealPointKey = null;
            monitorState.healPointRepeatCount = 0;
        };
        const pollHelpers = HealPipelinePoller.create({
            poller,
            attemptLogger,
            recoveryManager,
            resetRecovery,
            resetHealPointTracking,
            getDurationMs,
            onDetached
        });
        const revalidateHelpers = HealPipelineRevalidate.create({
            poller,
            attemptLogger,
            recoveryManager,
            resetRecovery,
            resetHealPointTracking,
            getDurationMs
        });
        const seekHelpers = HealPipelineSeek.create({ attemptLogger });
        const ensureAttached = (video, videoId, reason, message) => {
            if (document.contains(video)) return true;
            Logger.add(LogEvents.tagged('DETACHED', message), {
                reason,
                videoId
            });
            onDetached(video, reason);
            return false;
        };
        const buildTransitions = (monitorState) => PlaybackStateTransitions.create({
            state: monitorState,
            setState: (nextState, reason) => PlaybackStateStore.setState(monitorState, nextState, {
                reason
            })
        });
        const buildOutcome = (status, detail = {}) => ({ status, ...detail });
        const requireAttached = (video, videoId, reason, message, phase) => (
            ensureAttached(video, videoId, reason, message)
                ? null
                : buildOutcome(OutcomeStatus.ABORTED, { phase, reason })
        );
        const mapPollOutcome = (pollOutcome) => {
            if (pollOutcome.status === 'found') return null;
            if (pollOutcome.status === 'recovered') {
                return buildOutcome(OutcomeStatus.RECOVERED, { phase: 'poll' });
            }
            if (pollOutcome.status === 'no_point') {
                return buildOutcome(OutcomeStatus.NO_POINT, { phase: 'poll' });
            }
            if (pollOutcome.status === 'aborted') {
                return buildOutcome(OutcomeStatus.ABORTED, { phase: 'poll' });
            }
            return buildOutcome(OutcomeStatus.FAILED, { phase: 'poll', reason: pollOutcome.status });
        };
        const mapRevalidateOutcome = (revalidateOutcome) => {
            if (revalidateOutcome.status === 'ready') return null;
            if (revalidateOutcome.status === 'recovered') {
                return buildOutcome(OutcomeStatus.RECOVERED, { phase: 'revalidate' });
            }
            if (revalidateOutcome.status === 'stale_gone') {
                return buildOutcome(OutcomeStatus.NO_POINT, { phase: 'revalidate', reason: 'stale_gone' });
            }
            return buildOutcome(OutcomeStatus.FAILED, { phase: 'revalidate', reason: revalidateOutcome.status });
        };
        const finalizeMonitorState = (monitorState, video) => {
            if (!monitorState) return;
            const transitions = buildTransitions(monitorState);
            if (video.paused) {
                transitions.toPaused('heal_finalize_paused', { allowDuringHealing: true });
            } else if (poller.hasRecovered(video, monitorState)) {
                transitions.toPlaying('heal_finalize_recovered', { allowDuringHealing: true });
            } else {
                transitions.toStalled('heal_finalize_stalled', { allowDuringHealing: true });
            }
        };
        const runHealAttempt = async (context, healStartTime) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId;
            const pollOutcome = await pollHelpers.pollForHealPoint(video, monitorState, videoId, healStartTime);
            const pollResult = mapPollOutcome(pollOutcome);
            if (pollResult) return pollResult;
            const revalidateAttach = requireAttached(
                video,
                videoId,
                'pre_revalidate',
                'Heal aborted before revalidation',
                'revalidate'
            );
            if (revalidateAttach) return revalidateAttach;
            const revalidateOutcome = revalidateHelpers.revalidateHealPoint(
                video,
                monitorState,
                videoId,
                pollOutcome.healPoint,
                healStartTime
            );
            const revalidateResult = mapRevalidateOutcome(revalidateOutcome);
            if (revalidateResult) return revalidateResult;
            const seekAttach = requireAttached(
                video,
                videoId,
                'pre_seek',
                'Heal aborted before seek',
                'seek'
            );
            if (seekAttach) return seekAttach;
            const seekOutcome = await seekHelpers.attemptSeekWithRetry(video, revalidateOutcome.healPoint);
            const duration = getDurationMs(healStartTime);
            if (seekOutcome.result.success) {
                const bufferEndDelta = HealAttemptUtils.getBufferEndDelta(video);
                attemptLogger.logHealComplete({
                    durationMs: duration,
                    healAttempts: state.healAttempts,
                    bufferEndDelta,
                    video,
                    videoId
                });
                Metrics.increment('heals_successful');
                resetRecovery(monitorState, 'heal_success');
                catchUpController.scheduleCatchUp(video, monitorState, videoId, 'post_heal');
                return buildOutcome(OutcomeStatus.FOUND, { phase: 'seek', healPoint: seekOutcome.finalPoint });
            }
            const repeatCount = HealAttemptUtils.updateHealPointRepeat(
                monitorState,
                seekOutcome.finalPoint,
                false
            );
            if (HealAttemptUtils.isAbortError(seekOutcome.result)) {
                attemptLogger.logAbortContext({
                    result: seekOutcome.result,
                    monitorState,
                    video
                });
            }
            attemptLogger.logHealFailed({
                durationMs: duration,
                result: seekOutcome.result,
                finalPoint: seekOutcome.finalPoint,
                video,
                videoId
            });
            Metrics.increment('heals_failed');
            if (monitorState && recoveryManager.handlePlayFailure
                && (HealAttemptUtils.isPlayFailure(seekOutcome.result)
                    || repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT)) {
                recoveryManager.handlePlayFailure(video, monitorState, {
                    reason: HealAttemptUtils.isPlayFailure(seekOutcome.result)
                        ? 'play_error'
                        : 'healpoint_repeat',
                    error: seekOutcome.result.error,
                    errorName: seekOutcome.result.errorName,
                    healRange: seekOutcome.finalPoint
                        ? `${seekOutcome.finalPoint.start.toFixed(2)}-${seekOutcome.finalPoint.end.toFixed(2)}`
                        : null,
                    healPointRepeatCount: repeatCount
                });
            }

            const status = HealAttemptUtils.isAbortError(seekOutcome.result)
                ? OutcomeStatus.ABORTED
                : OutcomeStatus.FAILED;
            return buildOutcome(status, { phase: 'seek', result: seekOutcome.result });
        };

        const finalizeAttempt = (context, outcome) => {
            state.isHealing = false;
            finalizeMonitorState(context.monitorState, context.video);
            return outcome;
        };

        const attemptHeal = async (videoOrContext, monitorStateOverride) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId);
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId;

            if (state.isHealing) {
                Logger.add(LogEvents.tagged('BLOCKED', 'Already healing'));
                return;
            }

            if (!ensureAttached(video, videoId, 'pre_heal', 'Heal skipped, video not in DOM')) {
                return;
            }

            state.isHealing = true;
            state.healAttempts++;
            const healStartTime = performance.now();
            if (monitorState) {
                const transitions = buildTransitions(monitorState);
                transitions.toHealing('heal_start');
                monitorState.lastHealAttemptTime = Date.now();
            }

            attemptLogger.logStart({
                attempt: state.healAttempts,
                monitorState,
                video,
                videoId
            });

            let outcome = null;
            try {
                outcome = await runHealAttempt(context, healStartTime);
            } catch (e) {
                Logger.add(LogEvents.tagged('ERROR', 'Unexpected error during heal'), {
                    error: e.name,
                    message: e.message,
                    stack: e.stack?.split('\n')[0]
                });
                Metrics.increment('heals_failed');
                outcome = buildOutcome(OutcomeStatus.FAILED, { phase: 'error', error: e.name });
            } finally {
                finalizeAttempt(context, outcome);
            }
            return outcome;
        };

        return {
            attemptHeal,
            isHealing: () => state.isHealing,
            getAttempts: () => state.healAttempts
        };
    };

    return { create };
})();
