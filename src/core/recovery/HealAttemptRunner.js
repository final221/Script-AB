// --- HealAttemptRunner ---
/**
 * Executes heal attempts as explicit phases.
 */
const HealAttemptRunner = (() => {
    const Phase = Object.freeze({
        POLL: 'poll',
        REVALIDATE: 'revalidate',
        SEEK: 'seek'
    });

    const create = (options) => {
        const pollHelpers = options.pollHelpers;
        const revalidateHelpers = options.revalidateHelpers;
        const seekHelpers = options.seekHelpers;
        const getDurationMs = options.getDurationMs;
        const attemptLogger = options.attemptLogger;
        const catchUpController = options.catchUpController;
        const resetRecovery = options.resetRecovery;
        const recoveryManager = options.recoveryManager;
        const OutcomeStatus = options.OutcomeStatus;
        const buildOutcome = options.buildOutcome;
        const requireAttached = options.requireAttached;
        const state = options.state;

        const finalizeOutcome = (status, phase, detail = {}) => ({
            outcome: buildOutcome(status, { phase, ...detail })
        });

        const buildPhaseHandlers = ({ context, healStartTime }) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId;

            return {
                [Phase.POLL]: async () => {
                    const pollOutcome = await pollHelpers.pollForHealPoint(
                        video,
                        monitorState,
                        videoId,
                        healStartTime
                    );
                    if (pollOutcome.status === 'found') {
                        return {
                            nextPhase: Phase.REVALIDATE,
                            healPoint: pollOutcome.healPoint
                        };
                    }
                    if (pollOutcome.status === 'recovered') {
                        return finalizeOutcome(OutcomeStatus.RECOVERED, Phase.POLL);
                    }
                    if (pollOutcome.status === 'no_point') {
                        return finalizeOutcome(OutcomeStatus.NO_POINT, Phase.POLL);
                    }
                    if (pollOutcome.status === 'aborted') {
                        return finalizeOutcome(OutcomeStatus.ABORTED, Phase.POLL);
                    }
                    return finalizeOutcome(OutcomeStatus.FAILED, Phase.POLL, {
                        reason: pollOutcome.status
                    });
                },
                [Phase.REVALIDATE]: (currentHealPoint) => {
                    const revalidateAttach = requireAttached(
                        video,
                        videoId,
                        'pre_revalidate',
                        'Heal aborted before revalidation',
                        Phase.REVALIDATE
                    );
                    if (revalidateAttach) return { outcome: revalidateAttach };
                    const revalidateOutcome = revalidateHelpers.revalidateHealPoint(
                        video,
                        monitorState,
                        videoId,
                        currentHealPoint,
                        healStartTime
                    );
                    if (revalidateOutcome.status === 'ready') {
                        return {
                            nextPhase: Phase.SEEK,
                            healPoint: revalidateOutcome.healPoint
                        };
                    }
                    if (revalidateOutcome.status === 'recovered') {
                        return finalizeOutcome(OutcomeStatus.RECOVERED, Phase.REVALIDATE);
                    }
                    if (revalidateOutcome.status === 'stale_gone') {
                        return finalizeOutcome(OutcomeStatus.NO_POINT, Phase.REVALIDATE, {
                            reason: 'stale_gone'
                        });
                    }
                    return finalizeOutcome(OutcomeStatus.FAILED, Phase.REVALIDATE, {
                        reason: revalidateOutcome.status
                    });
                },
                [Phase.SEEK]: async (currentHealPoint) => {
                    const seekAttach = requireAttached(
                        video,
                        videoId,
                        'pre_seek',
                        'Heal aborted before seek',
                        Phase.SEEK
                    );
                    if (seekAttach) return { outcome: seekAttach };
                    const seekOutcome = await seekHelpers.attemptSeekWithRetry(video, currentHealPoint);
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
                        return finalizeOutcome(OutcomeStatus.FOUND, Phase.SEEK, {
                            healPoint: seekOutcome.finalPoint
                        });
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
                    return finalizeOutcome(status, Phase.SEEK, {
                        result: seekOutcome.result
                    });
                }
            };
        };

        const runHealAttempt = async (context, healStartTime) => {
            const handlers = buildPhaseHandlers({ context, healStartTime });
            let phase = Phase.POLL;
            let healPoint = null;

            while (phase) {
                const handler = handlers[phase];
                if (!handler) {
                    break;
                }
                const result = await handler(healPoint);
                if (result?.outcome) {
                    return result.outcome;
                }
                if (result?.nextPhase) {
                    phase = result.nextPhase;
                    healPoint = result.healPoint ?? healPoint;
                    continue;
                }
                break;
            }

            return buildOutcome(OutcomeStatus.FAILED, { phase: phase || 'unknown' });
        };

        return { runHealAttempt };
    };

    return { create };
})();
