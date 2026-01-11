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
        const poller = HealPointPoller.create({
            getVideoId,
            logWithState,
            logDebug: options.logDebug
        });

        const state = {
            isHealing: false,
            healAttempts: 0
        };

        const attemptHeal = async (video, monitorState) => {
            if (state.isHealing) {
                Logger.add('[HEALER:BLOCKED] Already healing');
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
                const healPoint = await poller.pollForHealPoint(
                    video,
                    monitorState,
                    CONFIG.stall.HEAL_TIMEOUT_S * 1000
                );

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
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_failed');
                    recoveryManager.handleNoHealPoint(video, monitorState, 'no_heal_point');
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

                const targetPoint = freshPoint;
                if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                    Logger.add('[HEALER:POINT_UPDATED] Using refreshed heal point', {
                        original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                        type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                    });
                }

                const result = await LiveEdgeSeeker.seekAndPlay(video, targetPoint);

                const duration = (performance.now() - healStartTime).toFixed(0);

                if (result.success) {
                    Logger.add('[HEALER:COMPLETE] Stream healed successfully', {
                        duration: duration + 'ms',
                        healAttempts: state.healAttempts,
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    Metrics.increment('heals_successful');
                    recoveryManager.resetBackoff(monitorState, 'heal_success');
                } else {
                    Logger.add('[HEALER:FAILED] Heal attempt failed', {
                        duration: duration + 'ms',
                        error: result.error,
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
