// --- RecoveryDecisionApplier ---
/**
 * Applies recovery policy decisions with centralized side effects.
 */
const RecoveryDecisionApplier = (() => {
    const create = (options = {}) => {
        const backoffManager = options.backoffManager;
        const candidateSelector = options.candidateSelector;
        const logDebug = options.logDebug || (() => {});
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const probationPolicy = options.probationPolicy;
        const applyEmergencySwitch = (monitorState, reason, now, switchOptions = {}) => {
            if (!monitorState || !candidateSelector || typeof candidateSelector.selectEmergencyCandidate !== 'function') {
                return false;
            }
            const switched = candidateSelector.selectEmergencyCandidate(reason, switchOptions);
            if (switched) {
                PlaybackStateStore.markEmergencySwitch(monitorState, now);
                return true;
            }
            return false;
        };
        const applyRefresh = (videoId, monitorState, reason, now) => {
            if (!monitorState) return false;
            PlaybackStateStore.markRefresh(monitorState, now);
            PlaybackStateStore.setNoHealPointRefreshUntil(monitorState, 0);
            logDebug(
                LogEvents.tagged('REFRESH', 'Refreshing video after repeated no-heal points'),
                RecoveryLogDetails.refresh({
                    videoId,
                    reason,
                    noHealPointCount: monitorState.noHealPointCount
                })
            );
            PlaybackStateStore.setNoHealPointCount(monitorState, 0);
            onPersistentFailure(videoId, {
                reason,
                detail: 'no_heal_point'
            });
            return true;
        };
        const applyNoHealPointDecision = (decision) => {
            if (!decision || decision.type !== 'no_heal_point') {
                return {
                    shouldFailover: false,
                    refreshed: false,
                    probationTriggered: false,
                    emergencySwitched: false
                };
            }
            const context = decision.context || {};
            const data = decision.data || {};
            const videoId = context.videoId;
            const monitorState = context.monitorState;
            const reason = context.reason || data.reason;
            const now = context.now || data.now;
            backoffManager.applyBackoff(videoId, monitorState, reason);
            if (data.quietEligible && monitorState) {
                PlaybackStateStore.setNoHealPointQuiet(monitorState, data.quietUntil);
                Logger.add(LogEvents.tagged('BACKOFF', 'Recovery quieted after repeated no-heal points'), {
                    videoId,
                    noHealPointCount: monitorState.noHealPointCount,
                    quietMs: CONFIG.stall.NO_HEAL_POINT_QUIET_MS,
                    stalledForMs: data.stalledForMs,
                    bufferStarved: data.bufferStarved
                });
                return {
                    shouldFailover: false,
                    refreshed: false,
                    probationTriggered: false,
                    emergencySwitched: false
                };
            }
            if (data.shouldSetRefreshWindow && monitorState) {
                PlaybackStateStore.setNoHealPointRefreshUntil(monitorState, data.refreshUntil);
            }
            if (data.shouldRescanNoBuffer) {
                if (probationPolicy?.triggerRescanForKey) {
                    probationPolicy.triggerRescanForKey(`no_buffer:${videoId}`, 'no_buffer', {
                        videoId,
                        reason,
                        bufferRanges: 'none'
                    });
                } else if (candidateSelector) {
                    candidateSelector.activateProbation('no_buffer');
                    onRescan('no_buffer', {
                        videoId,
                        reason,
                        bufferRanges: 'none'
                    });
                }
            }
            const probationTriggered = data.probationEligible
                ? probationPolicy.maybeTriggerProbation(
                    videoId,
                    monitorState,
                    reason,
                    monitorState?.noHealPointCount || 0,
                    CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS
                )
                : false;
            const emergencySwitched = data.emergencyEligible
                ? applyEmergencySwitch(monitorState, reason, now)
                : false;
            const lastResortSwitched = !emergencySwitched && data.lastResortEligible
                ? applyEmergencySwitch(monitorState, `${reason}_last_resort`, now, {
                    minReadyState: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_MIN_READY_STATE,
                    requireSrc: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC,
                    allowDead: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD
                })
                : false;
            const refreshed = !emergencySwitched && !lastResortSwitched && data.refreshEligible
                ? applyRefresh(videoId, monitorState, reason, now)
                : false;

            return {
                shouldFailover: data.shouldFailover,
                refreshed,
                probationTriggered,
                emergencySwitched: emergencySwitched || lastResortSwitched
            };
        };
        const applyPlayFailureDecision = (decision) => {
            if (!decision || decision.type !== 'play_error') {
                return {
                    shouldFailover: false,
                    probationTriggered: false,
                    repeatStuck: false
                };
            }
            const context = decision.context || {};
            const data = decision.data || {};
            const monitorState = context.monitorState;
            if (!monitorState) {
                return {
                    shouldFailover: false,
                    probationTriggered: false,
                    repeatStuck: false
                };
            }
            const videoId = context.videoId;
            PlaybackStateStore.setPlayErrorBackoff(
                monitorState,
                data.count,
                data.now + data.backoffMs,
                data.now
            );
            Logger.add(LogEvents.tagged('PLAY_BACKOFF', 'Play failed'), RecoveryLogDetails.playBackoff({
                videoId,
                reason: data.reason,
                error: data.error,
                errorName: data.errorName,
                playErrorCount: data.count,
                backoffMs: data.backoffMs,
                abortBackoff: data.isAbortError,
                nextHealAllowedInMs: data.backoffMs,
                healRange: data.healRange || null,
                healPointRepeatCount: data.healPointRepeatCount || 0
            }));
            if (data.repeatStuck) {
                Logger.add(LogEvents.tagged('HEALPOINT_STUCK', 'Repeated heal point loop'), {
                    videoId,
                    healRange: data.healRange || null,
                    repeatCount: data.healPointRepeatCount,
                    errorName: data.errorName,
                    error: data.error
                });
            }
            const probationTriggered = data.probationEligible
                ? probationPolicy.maybeTriggerProbation(
                    videoId,
                    monitorState,
                    data.reason || 'play_error',
                    data.count,
                    CONFIG.stall.PROBATION_AFTER_PLAY_ERRORS
                )
                : false;
            if (data.repeatStuck && !probationTriggered) {
                probationPolicy?.triggerRescan('healpoint_stuck', {
                    videoId,
                    count: data.healPointRepeatCount,
                    trigger: 'healpoint_stuck'
                });
            }
            return {
                shouldFailover: data.shouldFailover,
                probationTriggered,
                repeatStuck: data.repeatStuck
            };
        };
        const applyStallSkipDecision = (decision) => {
            if (!decision || decision.type !== 'stall_skip') return false;
            const data = decision.data || {};
            if (!data.shouldSkip) return false;
            const context = decision.context || {};
            const videoId = context.videoId;
            const monitorState = context.monitorState;
            const now = context.now;
            if (!monitorState) return true;
            if (data.reason === 'backoff' && data.backoff) {
                if (now - (monitorState.lastBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markBackoffLog(monitorState, now);
                    logDebug(LogEvents.tagged('BACKOFF', 'Stall skipped due to backoff'), {
                        videoId,
                        remainingMs: data.backoff.remainingMs,
                        noHealPointCount: data.backoff.noHealPointCount
                    });
                }
                return true;
            }
            if (data.reason === 'buffer_starve' && data.bufferStarve) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug(LogEvents.tagged('STARVE_SKIP', 'Stall skipped due to buffer starvation'), {
                        videoId,
                        remainingMs: data.bufferStarve.remainingMs,
                        bufferAhead: data.bufferStarve.bufferAhead !== null
                            ? data.bufferStarve.bufferAhead.toFixed(3)
                            : null
                    });
                }
                return true;
            }
            if (data.reason === 'play_backoff' && data.playBackoff) {
                if (now - (monitorState.lastPlayBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markPlayBackoffLog(monitorState, now);
                    logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Stall skipped due to play backoff'), {
                        videoId,
                        remainingMs: data.playBackoff.remainingMs,
                        playErrorCount: data.playBackoff.playErrorCount
                    });
                }
                return true;
            }
            if (data.reason === 'self_recover' && data.selfRecover) {
                if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastSelfRecoverSkipLogTime = now;
                    logDebug(LogEvents.tagged('SELF_RECOVER_SKIP', 'Stall skipped for self-recovery window'), {
                        videoId,
                        stalledForMs: data.selfRecover.stalledForMs,
                        graceMs: data.selfRecover.graceMs,
                        extraGraceMs: data.selfRecover.extraGraceMs,
                        signals: data.selfRecover.signals,
                        bufferAhead: data.selfRecover.bufferAhead,
                        bufferStarved: data.selfRecover.bufferStarved
                    });
                }
                return true;
            }
            return true;
        };

        const applyDecision = (decision) => {
            if (!decision || !decision.type) return null;
            if (decision.type === 'no_heal_point') {
                return applyNoHealPointDecision(decision);
            }
            if (decision.type === 'play_error') {
                return applyPlayFailureDecision(decision);
            }
            if (decision.type === 'stall_skip') {
                return applyStallSkipDecision(decision);
            }
            return null;
        };

        return {
            applyNoHealPointDecision,
            applyPlayFailureDecision,
            applyStallSkipDecision,
            applyDecision
        };
    };

    return { create };
})();
