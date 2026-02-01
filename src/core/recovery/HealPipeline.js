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
        const healingVideoIds = new Set();
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
        const attemptRunner = HealAttemptRunner.create({
            pollHelpers,
            revalidateHelpers,
            seekHelpers,
            getDurationMs,
            attemptLogger,
            catchUpController,
            resetRecovery,
            recoveryManager,
            OutcomeStatus,
            buildOutcome,
            requireAttached,
            state
        });

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

            const isActive = options.isActive || (() => true);
            if (!isActive(videoId, video)) {
                Logger.add(LogEvents.tagged('BLOCKED', 'Heal skipped for non-active video'), {
                    videoId
                });
                return buildOutcome(OutcomeStatus.ABORTED, { phase: 'active_check', reason: 'non_active' });
            }

            if (healingVideoIds.has(videoId)) {
                Logger.add(LogEvents.tagged('BLOCKED', 'Already healing video'), {
                    videoId
                });
                return buildOutcome(OutcomeStatus.ABORTED, { phase: 'lock', reason: 'already_healing' });
            }

            if (!ensureAttached(video, videoId, 'pre_heal', 'Heal skipped, video not in DOM')) {
                return buildOutcome(OutcomeStatus.ABORTED, { phase: 'pre_heal', reason: 'detached' });
            }

            healingVideoIds.add(videoId);
            state.isHealing = healingVideoIds.size > 0;
            state.healAttempts++;
            const healStartTime = performance.now();
            if (monitorState) {
                const transitions = buildTransitions(monitorState);
                transitions.toHealing('heal_start');
                PlaybackStateStore.markHealAttempt(monitorState, Date.now());
            }

            attemptLogger.logStart({
                attempt: state.healAttempts,
                monitorState,
                video,
                videoId
            });

            let outcome = null;
            try {
                outcome = await attemptRunner.runHealAttempt(context, healStartTime);
            } catch (e) {
                Logger.add(LogEvents.tagged('ERROR', 'Unexpected error during heal'), {
                    error: e.name,
                    message: e.message,
                    stack: e.stack?.split('\n')[0]
                });
                Metrics.increment('heals_failed');
                outcome = buildOutcome(OutcomeStatus.FAILED, { phase: 'error', error: e.name });
            } finally {
                healingVideoIds.delete(videoId);
                state.isHealing = healingVideoIds.size > 0;
                finalizeAttempt(context, outcome);
            }
            return outcome;
        };

        return {
            attemptHeal,
            isHealing: (videoId) => (
                videoId ? healingVideoIds.has(videoId) : state.isHealing
            ),
            getAttempts: () => state.healAttempts
        };
    };

    return { create };
})();
