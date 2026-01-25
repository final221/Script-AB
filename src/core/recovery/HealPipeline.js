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

        const state = {
            isHealing: false,
            healAttempts: 0
        };

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

        const ensureAttached = (video, videoId, reason, message) => {
            if (document.contains(video)) return true;
            Logger.add(LogEvents.tagged('DETACHED', message), {
                reason,
                videoId
            });
            onDetached(video, reason);
            return false;
        };

        const finalizeMonitorState = (monitorState, video) => {
            if (!monitorState) return;
            if (video.paused) {
                monitorState.state = MonitorStates.PAUSED;
            } else if (poller.hasRecovered(video, monitorState)) {
                monitorState.state = MonitorStates.PLAYING;
            } else {
                monitorState.state = MonitorStates.STALLED;
            }
        };

        const getDurationMs = (startTime) => Number((performance.now() - startTime).toFixed(0));

        const handlePollAbort = (video, videoId, reason) => {
            const abortReason = reason || 'poll_abort';
            Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted during polling'), {
                reason: abortReason,
                videoId
            });
            onDetached(video, abortReason);
        };

        const pollForHealPoint = async (video, monitorState, videoId, healStartTime) => {
            const pollResult = await poller.pollForHealPoint(
                video,
                monitorState,
                CONFIG.stall.HEAL_TIMEOUT_S * 1000
            );

            if (pollResult.aborted) {
                handlePollAbort(video, videoId, pollResult.reason);
                return { status: 'aborted' };
            }

            const healPoint = pollResult.healPoint;
            if (!healPoint) {
                if (poller.hasRecovered(video, monitorState)) {
                    attemptLogger.logSelfRecovered(getDurationMs(healStartTime), video, videoId);
                    resetRecovery(monitorState, 'self_recovered');
                    return { status: 'recovered' };
                }

                const noPointDuration = getDurationMs(healStartTime);
                attemptLogger.logNoHealPoint(noPointDuration, video, videoId);
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
                resetHealPointTracking(monitorState);
                return { status: 'no_point' };
            }

            return { status: 'found', healPoint };
        };

        const revalidateHealPoint = (video, monitorState, videoId, healPoint, healStartTime) => {
            const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
            if (!freshPoint) {
                if (poller.hasRecovered(video, monitorState)) {
                    attemptLogger.logStaleRecovered(getDurationMs(healStartTime));
                    resetRecovery(monitorState, 'stale_recovered');
                    return { status: 'recovered' };
                }
                attemptLogger.logStaleGone(healPoint, video, videoId);
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, monitorState, 'stale_gone');
                resetHealPointTracking(monitorState);
                return { status: 'stale_gone' };
            }

            if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                attemptLogger.logPointUpdated(healPoint, freshPoint);
            }

            return { status: 'ready', healPoint: freshPoint };
        };

        const attemptSeekWithRetry = async (video, targetPoint) => {
            const attemptSeekAndPlay = async (point, label) => {
                if (label) {
                    attemptLogger.logRetry(label, point);
                }
                return LiveEdgeSeeker.seekAndPlay(video, point);
            };

            let result = await attemptSeekAndPlay(targetPoint, null);
            let finalPoint = targetPoint;

            if (!result.success && HealAttemptUtils.isAbortError(result)) {
                await Fn.sleep(CONFIG.recovery.HEAL_RETRY_DELAY_MS);
                const retryPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                if (retryPoint) {
                    finalPoint = retryPoint;
                    result = await attemptSeekAndPlay(retryPoint, 'abort_error');
                } else {
                    attemptLogger.logRetrySkip(video, 'abort_error');
                }
            }

            return { result, finalPoint };
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
                monitorState.state = MonitorStates.HEALING;
                monitorState.lastHealAttemptTime = Date.now();
            }

            attemptLogger.logStart({
                attempt: state.healAttempts,
                monitorState,
                video,
                videoId
            });

            try {
                const pollOutcome = await pollForHealPoint(video, monitorState, videoId, healStartTime);
                if (pollOutcome.status !== 'found') {
                    return;
                }

                if (!ensureAttached(video, videoId, 'pre_revalidate', 'Heal aborted before revalidation')) {
                    return;
                }

                const revalidateOutcome = revalidateHealPoint(
                    video,
                    monitorState,
                    videoId,
                    pollOutcome.healPoint,
                    healStartTime
                );
                if (revalidateOutcome.status !== 'ready') {
                    return;
                }

                if (!ensureAttached(video, videoId, 'pre_seek', 'Heal aborted before seek')) {
                    return;
                }

                const seekOutcome = await attemptSeekWithRetry(video, revalidateOutcome.healPoint);
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
                } else {
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
                }
            } catch (e) {
                Logger.add(LogEvents.tagged('ERROR', 'Unexpected error during heal'), {
                    error: e.name,
                    message: e.message,
                    stack: e.stack?.split('\n')[0]
                });
                Metrics.increment('heals_failed');
            } finally {
                state.isHealing = false;
                finalizeMonitorState(monitorState, video);
            }
        };

        return {
            attemptHeal,
            isHealing: () => state.isHealing,
            getAttempts: () => state.healAttempts
        };
    };

    return { create };
})();
