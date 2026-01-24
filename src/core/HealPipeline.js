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

        const state = {
            isHealing: false,
            healAttempts: 0
        };

        const getBufferEndDelta = (video) => {
            const ranges = BufferGapFinder.getBufferRanges(video);
            if (!ranges.length) return null;
            const end = ranges[ranges.length - 1].end;
            return end - video.currentTime;
        };

        const scheduleCatchUp = (video, monitorState, videoId, reason) => {
            if (!monitorState || monitorState.catchUpTimeoutId) return;
            monitorState.catchUpAttempts = 0;
            const delayMs = CONFIG.recovery.CATCH_UP_DELAY_MS;
            Logger.add(LogEvents.tagged('CATCH_UP', 'Scheduled'), {
                reason,
                delayMs,
                videoState: VideoStateSnapshot.forLog(video, videoId)
            });
            monitorState.catchUpTimeoutId = setTimeout(() => {
                attemptCatchUp(video, monitorState, videoId, reason);
            }, delayMs);
        };

        const attemptCatchUp = (video, monitorState, videoId, reason) => {
            if (!monitorState) return;
            monitorState.catchUpTimeoutId = null;
            monitorState.catchUpAttempts += 1;

            if (!document.contains(video)) {
                    Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (detached)'), {
                        reason,
                        attempts: monitorState.catchUpAttempts
                    });
                return;
            }

            const now = Date.now();
            const stallAgoMs = monitorState.lastStallEventTime
                ? (now - monitorState.lastStallEventTime)
                : null;
            const progressOk = monitorState.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS;
            const stableEnough = !video.paused
                && video.readyState >= 3
                && progressOk
                && (stallAgoMs === null || stallAgoMs >= CONFIG.recovery.CATCH_UP_STABLE_MS);

            if (!stableEnough) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Deferred (unstable)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts,
                    paused: video.paused,
                    readyState: video.readyState,
                    progressStreakMs: monitorState.progressStreakMs,
                    stallAgoMs
                });
                if (monitorState.catchUpAttempts < CONFIG.recovery.CATCH_UP_MAX_ATTEMPTS) {
                    monitorState.catchUpTimeoutId = setTimeout(() => {
                        attemptCatchUp(video, monitorState, reason);
                    }, CONFIG.recovery.CATCH_UP_RETRY_MS);
                }
                return;
            }

            const ranges = BufferGapFinder.getBufferRanges(video);
            if (!ranges.length) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (no buffer)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts
                });
                return;
            }

            const liveRange = ranges[ranges.length - 1];
            const bufferEnd = liveRange.end;
            const behindS = bufferEnd - video.currentTime;

            if (behindS < CONFIG.recovery.CATCH_UP_MIN_S) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (already near live)'), {
                    reason,
                    behindS: behindS.toFixed(2)
                });
                return;
            }

            const target = Math.max(video.currentTime, bufferEnd - CONFIG.recovery.HEAL_EDGE_GUARD_S);
            const validation = SeekTargetCalculator.validateSeekTarget(video, target);
            const bufferRanges = BufferGapFinder.formatRanges(ranges);

            if (!validation.valid) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (invalid target)'), {
                    reason,
                    target: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges,
                    validation: validation.reason
                });
                return;
            }

            try {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Seeking toward live edge'), {
                    reason,
                    from: video.currentTime.toFixed(3),
                    to: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges
                });
                video.currentTime = target;
                monitorState.lastCatchUpTime = now;
            } catch (error) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Seek failed'), {
                    reason,
                    error: error?.name,
                    message: error?.message
                });
            }
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

            const startSnapshot = StateSnapshot.full(video, videoId);
            const startSummary = LogEvents.summary.healStart({
                attempt: state.healAttempts,
                lastProgressAgoMs: monitorState ? (Date.now() - monitorState.lastProgressTime) : null,
                currentTime: startSnapshot?.currentTime ? Number(startSnapshot.currentTime) : null,
                paused: startSnapshot?.paused,
                readyState: startSnapshot?.readyState,
                networkState: startSnapshot?.networkState,
                buffered: startSnapshot?.buffered
            });
            Logger.add(startSummary, {
                attempt: state.healAttempts,
                lastProgressAgoMs: monitorState ? (Date.now() - monitorState.lastProgressTime) : undefined,
                videoId,
                videoState: startSnapshot
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
                        Logger.add(LogEvents.tagged('SKIPPED', 'Video recovered, no heal needed'), {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                            finalState: VideoStateSnapshot.forLog(video, videoId)
                        });
                        recoveryManager.resetBackoff(monitorState, 'self_recovered');
                        if (recoveryManager.resetPlayError) {
                            recoveryManager.resetPlayError(monitorState, 'self_recovered');
                        }
                        return;
                    }

                    const noPointDuration = Number((performance.now() - healStartTime).toFixed(0));
                    const noPointSummary = LogEvents.summary.noHealPoint({
                        duration: noPointDuration,
                        currentTime: video.currentTime,
                        bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    });
                    Logger.add(noPointSummary, {
                        duration: noPointDuration + 'ms',
                        suggestion: 'User may need to refresh page',
                        currentTime: video.currentTime?.toFixed(3),
                        bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
                        finalState: VideoStateSnapshot.forLog(video, videoId)
                    });
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
                        Logger.add(LogEvents.tagged('STALE_RECOVERED', 'Heal point gone, but video recovered'), {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms'
                        });
                        recoveryManager.resetBackoff(monitorState, 'stale_recovered');
                        if (recoveryManager.resetPlayError) {
                            recoveryManager.resetPlayError(monitorState, 'stale_recovered');
                        }
                        return;
                    }
                    Logger.add(LogEvents.tagged('STALE_GONE', 'Heal point disappeared before seek'), {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        finalState: VideoStateSnapshot.forLog(video, videoId)
                    });
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
                    Logger.add(LogEvents.tagged('POINT_UPDATED', 'Using refreshed heal point'), {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                        type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                    });
                }

                const isAbortError = (result) => (
                    result?.errorName === 'AbortError'
                    || (typeof result?.error === 'string' && result.error.includes('aborted'))
                );

                const isPlayFailure = (result) => (
                    isAbortError(result)
                    || result?.errorName === 'PLAY_STUCK'
                );

                const updateHealPointRepeat = (monitorStateRef, point, succeeded) => {
                    if (!monitorStateRef) return 0;
                    if (succeeded || !point) {
                        monitorStateRef.lastHealPointKey = null;
                        monitorStateRef.healPointRepeatCount = 0;
                        return 0;
                    }
                    const key = `${point.start.toFixed(2)}-${point.end.toFixed(2)}`;
                    if (monitorStateRef.lastHealPointKey === key) {
                        monitorStateRef.healPointRepeatCount = (monitorStateRef.healPointRepeatCount || 0) + 1;
                    } else {
                        monitorStateRef.lastHealPointKey = key;
                        monitorStateRef.healPointRepeatCount = 1;
                    }
                    return monitorStateRef.healPointRepeatCount;
                };

                const attemptSeekAndPlay = async (point, label) => {
                    if (label) {
                        Logger.add(LogEvents.tagged('RETRY', 'Retrying heal'), {
                            attempt: label,
                            healRange: `${point.start.toFixed(2)}-${point.end.toFixed(2)}`,
                            gapSize: point.gapSize?.toFixed(2),
                            isNudge: point.isNudge
                        });
                    }
                    return LiveEdgeSeeker.seekAndPlay(video, point);
                };

                let result = await attemptSeekAndPlay(targetPoint, null);
                let finalPoint = targetPoint;

                if (!result.success && isAbortError(result)) {
                    await Fn.sleep(CONFIG.recovery.HEAL_RETRY_DELAY_MS);
                    const retryPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                    if (retryPoint) {
                        finalPoint = retryPoint;
                        result = await attemptSeekAndPlay(retryPoint, 'abort_error');
                    } else {
                        Logger.add(LogEvents.tagged('RETRY_SKIP', 'Retry skipped, no heal point available'), {
                            reason: 'abort_error',
                            currentTime: video.currentTime?.toFixed(3),
                            bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                        });
                    }
                }

                const duration = Number((performance.now() - healStartTime).toFixed(0));

                if (result.success) {
                    const bufferEndDelta = getBufferEndDelta(video);
                    const completeSummary = LogEvents.summary.healComplete({
                        duration,
                        healAttempts: state.healAttempts,
                        bufferEndDelta
                    });
                    Logger.add(completeSummary, {
                        duration: duration + 'ms',
                        healAttempts: state.healAttempts,
                        bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null,
                        finalState: VideoStateSnapshot.forLog(video, videoId)
                    });
                    Metrics.increment('heals_successful');
                    recoveryManager.resetBackoff(monitorState, 'heal_success');
                    if (recoveryManager.resetPlayError) {
                        recoveryManager.resetPlayError(monitorState, 'heal_success');
                    }
                    scheduleCatchUp(video, monitorState, videoId, 'post_heal');
                } else {
                    const repeatCount = updateHealPointRepeat(monitorState, finalPoint, false);
                    if (isAbortError(result)) {
                        const bufferRanges = BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video));
                        Logger.add(LogEvents.tagged('ABORT_CONTEXT', 'Play aborted during heal'), {
                            error: result.error,
                            errorName: result.errorName,
                            stalledForMs: monitorState?.lastProgressTime
                                ? (Date.now() - monitorState.lastProgressTime)
                                : null,
                            bufferStarved: monitorState?.bufferStarved || false,
                            bufferStarvedSinceMs: monitorState?.bufferStarvedSince
                                ? (Date.now() - monitorState.bufferStarvedSince)
                                : null,
                            bufferStarveUntilMs: monitorState?.bufferStarveUntil
                                ? Math.max(monitorState.bufferStarveUntil - Date.now(), 0)
                                : null,
                            bufferAhead: monitorState?.lastBufferAhead ?? null,
                            bufferRanges,
                            readyState: video.readyState,
                            networkState: video.networkState
                        });
                    }
                    const failedSummary = LogEvents.summary.healFailed({
                        duration,
                        errorName: result.errorName,
                        error: result.error,
                        healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
                        gapSize: finalPoint?.gapSize,
                        isNudge: finalPoint?.isNudge
                    });
                    Logger.add(failedSummary, {
                        duration: duration + 'ms',
                        error: result.error,
                        errorName: result.errorName,
                        healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
                        isNudge: finalPoint?.isNudge,
                        gapSize: finalPoint?.gapSize?.toFixed(2),
                        finalState: VideoStateSnapshot.forLog(video, videoId)
                    });
                    Metrics.increment('heals_failed');
                    if (monitorState && recoveryManager.handlePlayFailure
                        && (isPlayFailure(result)
                            || repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT)) {
                        recoveryManager.handlePlayFailure(video, monitorState, {
                            reason: isPlayFailure(result) ? 'play_error' : 'healpoint_repeat',
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
