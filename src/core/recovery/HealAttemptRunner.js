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

        const runHealAttempt = async (context, healStartTime) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId;
            let phase = Phase.POLL;
            let healPoint = null;

            while (phase) {
                if (phase === Phase.POLL) {
                    const pollOutcome = await pollHelpers.pollForHealPoint(
                        video,
                        monitorState,
                        videoId,
                        healStartTime
                    );
                    if (pollOutcome.status === 'found') {
                        healPoint = pollOutcome.healPoint;
                        phase = Phase.REVALIDATE;
                        continue;
                    }
                    if (pollOutcome.status === 'recovered') {
                        return buildOutcome(OutcomeStatus.RECOVERED, { phase });
                    }
                    if (pollOutcome.status === 'no_point') {
                        return buildOutcome(OutcomeStatus.NO_POINT, { phase });
                    }
                    if (pollOutcome.status === 'aborted') {
                        return buildOutcome(OutcomeStatus.ABORTED, { phase });
                    }
                    return buildOutcome(OutcomeStatus.FAILED, { phase, reason: pollOutcome.status });
                }

                if (phase === Phase.REVALIDATE) {
                    const revalidateAttach = requireAttached(
                        video,
                        videoId,
                        'pre_revalidate',
                        'Heal aborted before revalidation',
                        Phase.REVALIDATE
                    );
                    if (revalidateAttach) return revalidateAttach;
                    const revalidateOutcome = revalidateHelpers.revalidateHealPoint(
                        video,
                        monitorState,
                        videoId,
                        healPoint,
                        healStartTime
                    );
                    if (revalidateOutcome.status === 'ready') {
                        healPoint = revalidateOutcome.healPoint;
                        phase = Phase.SEEK;
                        continue;
                    }
                    if (revalidateOutcome.status === 'recovered') {
                        return buildOutcome(OutcomeStatus.RECOVERED, { phase });
                    }
                    if (revalidateOutcome.status === 'stale_gone') {
                        return buildOutcome(OutcomeStatus.NO_POINT, { phase, reason: 'stale_gone' });
                    }
                    return buildOutcome(OutcomeStatus.FAILED, { phase, reason: revalidateOutcome.status });
                }

                if (phase === Phase.SEEK) {
                    const seekAttach = requireAttached(
                        video,
                        videoId,
                        'pre_seek',
                        'Heal aborted before seek',
                        Phase.SEEK
                    );
                    if (seekAttach) return seekAttach;
                    const seekOutcome = await seekHelpers.attemptSeekWithRetry(video, healPoint);
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
                        return buildOutcome(OutcomeStatus.FOUND, {
                            phase,
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
                    return buildOutcome(status, { phase, result: seekOutcome.result });
                }

                phase = null;
            }

            return buildOutcome(OutcomeStatus.FAILED, { phase: 'unknown' });
        };

        return { runHealAttempt };
    };

    return { create };
})();
