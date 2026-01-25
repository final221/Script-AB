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

        const attemptHeal = async (videoOrContext, monitorStateOverride) => {
            const context = RecoveryContext.from(videoOrContext, monitorStateOverride, getVideoId);
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId;

            if (state.isHealing) {
                Logger.add(LogEvents.tagged('BLOCKED', 'Already healing'));
                return;
            }

            if (!document.contains(video)) {
                Logger.add(LogEvents.tagged('DETACHED', 'Heal skipped, video not in DOM'), {
                    reason: 'pre_heal',
                    videoId
                });
                onDetached(video, 'pre_heal');
                return;
            }

            state.isHealing = true;
            state.healAttempts++;
            const healStartTime = performance.now();
            if (monitorState) {
                monitorState.state = 'HEALING';
                monitorState.lastHealAttemptTime = Date.now();
            }

            attemptLogger.logStart({
                attempt: state.healAttempts,
                monitorState,
                video,
                videoId
            });

            try {
                const pollResult = await poller.pollForHealPoint(
                    video,
                    monitorState,
                    CONFIG.stall.HEAL_TIMEOUT_S * 1000
                );

                if (pollResult.aborted) {
                    Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted during polling'), {
                        reason: pollResult.reason || 'poll_abort',
                        videoId
                    });
                    onDetached(video, pollResult.reason || 'poll_abort');
                    return;
                }

                const healPoint = pollResult.healPoint;
                if (!healPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        attemptLogger.logSelfRecovered(
                            Number((performance.now() - healStartTime).toFixed(0)),
                            video,
                            videoId
                        );
                        recoveryManager.resetBackoff(monitorState, 'self_recovered');
                        if (recoveryManager.resetPlayError) {
                            recoveryManager.resetPlayError(monitorState, 'self_recovered');
                        }
                        return;
                    }

                    const noPointDuration = Number((performance.now() - healStartTime).toFixed(0));
                    attemptLogger.logNoHealPoint(noPointDuration, video, videoId);
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
                    if (monitorState) {
                        monitorState.lastHealPointKey = null;
                        monitorState.healPointRepeatCount = 0;
                    }
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted before revalidation'), {
                        reason: 'pre_revalidate',
                        videoId
                    });
                    onDetached(video, 'pre_revalidate');
                    return;
                }

                const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                if (!freshPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        attemptLogger.logStaleRecovered(
                            Number((performance.now() - healStartTime).toFixed(0))
                        );
                        recoveryManager.resetBackoff(monitorState, 'stale_recovered');
                        if (recoveryManager.resetPlayError) {
                            recoveryManager.resetPlayError(monitorState, 'stale_recovered');
                        }
                        return;
                    }
                    attemptLogger.logStaleGone(healPoint, video, videoId);
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'stale_gone');
                    if (monitorState) {
                        monitorState.lastHealPointKey = null;
                        monitorState.healPointRepeatCount = 0;
                    }
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add(LogEvents.tagged('DETACHED', 'Heal aborted before seek'), {
                        reason: 'pre_seek',
                        videoId
                    });
                    onDetached(video, 'pre_seek');
                    return;
                }

                const targetPoint = freshPoint;
                if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                    attemptLogger.logPointUpdated(healPoint, freshPoint);
                }

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

                const duration = Number((performance.now() - healStartTime).toFixed(0));

                if (result.success) {
                    const bufferEndDelta = HealAttemptUtils.getBufferEndDelta(video);
                    attemptLogger.logHealComplete({
                        durationMs: duration,
                        healAttempts: state.healAttempts,
                        bufferEndDelta,
                        video,
                        videoId
                    });
                    Metrics.increment('heals_successful');
                    recoveryManager.resetBackoff(monitorState, 'heal_success');
                    if (recoveryManager.resetPlayError) {
                        recoveryManager.resetPlayError(monitorState, 'heal_success');
                    }
                    catchUpController.scheduleCatchUp(video, monitorState, videoId, 'post_heal');
                } else {
                    const repeatCount = HealAttemptUtils.updateHealPointRepeat(monitorState, finalPoint, false);
                    if (HealAttemptUtils.isAbortError(result)) {
                        attemptLogger.logAbortContext({
                            result,
                            monitorState,
                            video
                        });
                    }
                    attemptLogger.logHealFailed({
                        durationMs: duration,
                        result,
                        finalPoint,
                        video,
                        videoId
                    });
                    Metrics.increment('heals_failed');
                    if (monitorState && recoveryManager.handlePlayFailure
                        && (HealAttemptUtils.isPlayFailure(result)
                            || repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT)) {
                        recoveryManager.handlePlayFailure(video, monitorState, {
                            reason: HealAttemptUtils.isPlayFailure(result) ? 'play_error' : 'healpoint_repeat',
                            error: result.error,
                            errorName: result.errorName,
                            healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
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
                if (monitorState) {
                    if (video.paused) {
                        monitorState.state = 'PAUSED';
                    } else if (poller.hasRecovered(video, monitorState)) {
                        monitorState.state = 'PLAYING';
                    } else {
                        monitorState.state = 'STALLED';
                    }
                }
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
