// --- HealPipeline ---
/**
 * Handles heal-point polling and seek recovery.
 */
const HealPipeline = (() => {
    const LOG = {
        START: '[HEALER:START]'
    };

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

        const scheduleCatchUp = (video, monitorState, reason) => {
            if (!monitorState || monitorState.catchUpTimeoutId) return;
            monitorState.catchUpAttempts = 0;
            const delayMs = CONFIG.recovery.CATCH_UP_DELAY_MS;
            Logger.add('[HEALER:CATCH_UP] Scheduled', {
                reason,
                delayMs,
                videoState: VideoState.get(video, getVideoId(video))
            });
            monitorState.catchUpTimeoutId = setTimeout(() => {
                attemptCatchUp(video, monitorState, reason);
            }, delayMs);
        };

        const attemptCatchUp = (video, monitorState, reason) => {
            if (!monitorState) return;
            monitorState.catchUpTimeoutId = null;
            monitorState.catchUpAttempts += 1;

            if (!document.contains(video)) {
                Logger.add('[HEALER:CATCH_UP] Skipped (detached)', {
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
                Logger.add('[HEALER:CATCH_UP] Deferred (unstable)', {
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
                Logger.add('[HEALER:CATCH_UP] Skipped (no buffer)', {
                    reason,
                    attempts: monitorState.catchUpAttempts
                });
                return;
            }

            const liveRange = ranges[ranges.length - 1];
            const bufferEnd = liveRange.end;
            const behindS = bufferEnd - video.currentTime;

            if (behindS < CONFIG.recovery.CATCH_UP_MIN_S) {
                Logger.add('[HEALER:CATCH_UP] Skipped (already near live)', {
                    reason,
                    behindS: behindS.toFixed(2)
                });
                return;
            }

            const target = Math.max(video.currentTime, bufferEnd - CONFIG.recovery.HEAL_EDGE_GUARD_S);
            const validation = SeekTargetCalculator.validateSeekTarget(video, target);
            const bufferRanges = BufferGapFinder.formatRanges(ranges);

            if (!validation.valid) {
                Logger.add('[HEALER:CATCH_UP] Skipped (invalid target)', {
                    reason,
                    target: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges,
                    validation: validation.reason
                });
                return;
            }

            try {
                Logger.add('[HEALER:CATCH_UP] Seeking toward live edge', {
                    reason,
                    from: video.currentTime.toFixed(3),
                    to: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges
                });
                video.currentTime = target;
                monitorState.lastCatchUpTime = now;
            } catch (error) {
                Logger.add('[HEALER:CATCH_UP] Seek failed', {
                    reason,
                    error: error?.name,
                    message: error?.message
                });
            }
        };

        const attemptHeal = async (video, monitorState) => {
            if (state.isHealing) {
                Logger.add('[HEALER:BLOCKED] Already healing');
                return;
            }

            if (!document.contains(video)) {
                Logger.add('[HEALER:DETACHED] Heal skipped, video not in DOM', {
                    reason: 'pre_heal',
                    videoId: getVideoId(video)
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

            logWithState(LOG.START, video, {
                attempt: state.healAttempts,
                lastProgressAgoMs: monitorState ? (Date.now() - monitorState.lastProgressTime) : undefined
            });

            try {
                const pollResult = await poller.pollForHealPoint(
                    video,
                    monitorState,
                    CONFIG.stall.HEAL_TIMEOUT_S * 1000
                );

                if (pollResult.aborted) {
                    Logger.add('[HEALER:DETACHED] Heal aborted during polling', {
                        reason: pollResult.reason || 'poll_abort',
                        videoId: getVideoId(video)
                    });
                    onDetached(video, pollResult.reason || 'poll_abort');
                    return;
                }

                const healPoint = pollResult.healPoint;
                if (!healPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        Logger.add('[HEALER:SKIPPED] Video recovered, no heal needed', {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                            finalState: VideoState.get(video, getVideoId(video))
                        });
                        recoveryManager.resetBackoff(monitorState, 'self_recovered');
                        return;
                    }

                    Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                        suggestion: 'User may need to refresh page',
                        currentTime: video.currentTime?.toFixed(3),
                        bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add('[HEALER:DETACHED] Heal aborted before revalidation', {
                        reason: 'pre_revalidate',
                        videoId: getVideoId(video)
                    });
                    onDetached(video, 'pre_revalidate');
                    return;
                }

                const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
                if (!freshPoint) {
                    if (poller.hasRecovered(video, monitorState)) {
                        Logger.add('[HEALER:STALE_RECOVERED] Heal point gone, but video recovered', {
                            duration: (performance.now() - healStartTime).toFixed(0) + 'ms'
                        });
                        recoveryManager.resetBackoff(monitorState, 'stale_recovered');
                        return;
                    }
                    Logger.add('[HEALER:STALE_GONE] Heal point disappeared before seek', {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'stale_gone');
                    return;
                }

                if (!document.contains(video)) {
                    Logger.add('[HEALER:DETACHED] Heal aborted before seek', {
                        reason: 'pre_seek',
                        videoId: getVideoId(video)
                    });
                    onDetached(video, 'pre_seek');
                    return;
                }

                const targetPoint = freshPoint;
                if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                    Logger.add('[HEALER:POINT_UPDATED] Using refreshed heal point', {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                        type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                    });
                }

                const isAbortError = (result) => (
                    result?.errorName === 'AbortError'
                    || (typeof result?.error === 'string' && result.error.includes('aborted'))
                );

                const attemptSeekAndPlay = async (point, label) => {
                    if (label) {
                        Logger.add('[HEALER:RETRY] Retrying heal', {
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
                        Logger.add('[HEALER:RETRY_SKIP] Retry skipped, no heal point available', {
                            reason: 'abort_error',
                            currentTime: video.currentTime?.toFixed(3),
                            bufferRanges: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                        });
                    }
                }

                const duration = (performance.now() - healStartTime).toFixed(0);

                if (result.success) {
                    const bufferEndDelta = getBufferEndDelta(video);
                    Logger.add('[HEALER:COMPLETE] Stream healed successfully', {
                        duration: duration + 'ms',
                        healAttempts: state.healAttempts,
                        bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null,
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_successful');
                    recoveryManager.resetBackoff(monitorState, 'heal_success');
                    scheduleCatchUp(video, monitorState, 'post_heal');
                } else {
                    Logger.add('[HEALER:FAILED] Heal attempt failed', {
                        duration: duration + 'ms',
                        error: result.error,
                        errorName: result.errorName,
                        healRange: finalPoint ? `${finalPoint.start.toFixed(2)}-${finalPoint.end.toFixed(2)}` : null,
                        isNudge: finalPoint?.isNudge,
                        gapSize: finalPoint?.gapSize?.toFixed(2),
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                }
            } catch (e) {
                Logger.add('[HEALER:ERROR] Unexpected error during heal', {
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
