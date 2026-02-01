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
            if (!decision) {
                return {
                    shouldFailover: false,
                    refreshed: false,
                    probationTriggered: false,
                    emergencySwitched: false
                };
            }
            const videoId = decision.videoId;
            const monitorState = decision.monitorState;
            const reason = decision.reason;
            const now = decision.now;
            backoffManager.applyBackoff(videoId, monitorState, reason);
            if (decision.quietEligible && monitorState) {
                PlaybackStateStore.setNoHealPointQuiet(monitorState, decision.quietUntil);
                Logger.add(LogEvents.tagged('BACKOFF', 'Recovery quieted after repeated no-heal points'), {
                    videoId,
                    noHealPointCount: monitorState.noHealPointCount,
                    quietMs: CONFIG.stall.NO_HEAL_POINT_QUIET_MS,
                    stalledForMs: decision.stalledForMs,
                    bufferStarved: decision.bufferStarved
                });
                return {
                    shouldFailover: false,
                    refreshed: false,
                    probationTriggered: false,
                    emergencySwitched: false
                };
            }
            if (decision.shouldSetRefreshWindow && monitorState) {
                PlaybackStateStore.setNoHealPointRefreshUntil(monitorState, decision.refreshUntil);
            }
            if (decision.shouldRescanNoBuffer) {
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
            const probationTriggered = decision.probationEligible
                ? probationPolicy.maybeTriggerProbation(
                    videoId,
                    monitorState,
                    reason,
                    monitorState?.noHealPointCount || 0,
                    CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS
                )
                : false;
            const emergencySwitched = decision.emergencyEligible
                ? applyEmergencySwitch(monitorState, reason, now)
                : false;
            const lastResortSwitched = !emergencySwitched && decision.lastResortEligible
                ? applyEmergencySwitch(monitorState, `${reason}_last_resort`, now, {
                    minReadyState: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_MIN_READY_STATE,
                    requireSrc: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC,
                    allowDead: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD
                })
                : false;
            const refreshed = !emergencySwitched && !lastResortSwitched && decision.refreshEligible
                ? applyRefresh(videoId, monitorState, reason, now)
                : false;

            return {
                shouldFailover: decision.shouldFailover,
                refreshed,
                probationTriggered,
                emergencySwitched: emergencySwitched || lastResortSwitched
            };
        };
        const applyPlayFailureDecision = (decision) => {
            if (!decision?.monitorState) {
                return {
                    shouldFailover: false,
                    probationTriggered: false,
                    repeatStuck: false
                };
            }
            const monitorState = decision.monitorState;
            const videoId = decision.videoId;
            PlaybackStateStore.setPlayErrorBackoff(
                monitorState,
                decision.count,
                decision.now + decision.backoffMs,
                decision.now
            );
            Logger.add(LogEvents.tagged('PLAY_BACKOFF', 'Play failed'), RecoveryLogDetails.playBackoff({
                videoId,
                reason: decision.reason,
                error: decision.error,
                errorName: decision.errorName,
                playErrorCount: decision.count,
                backoffMs: decision.backoffMs,
                abortBackoff: decision.isAbortError,
                nextHealAllowedInMs: decision.backoffMs,
                healRange: decision.healRange || null,
                healPointRepeatCount: decision.healPointRepeatCount || 0
            }));
            if (decision.repeatStuck) {
                Logger.add(LogEvents.tagged('HEALPOINT_STUCK', 'Repeated heal point loop'), {
                    videoId,
                    healRange: decision.healRange || null,
                    repeatCount: decision.healPointRepeatCount,
                    errorName: decision.errorName,
                    error: decision.error
                });
            }
            const probationTriggered = decision.probationEligible
                ? probationPolicy.maybeTriggerProbation(
                    videoId,
                    monitorState,
                    decision.reason || 'play_error',
                    decision.count,
                    CONFIG.stall.PROBATION_AFTER_PLAY_ERRORS
                )
                : false;
            if (decision.repeatStuck && !probationTriggered) {
                probationPolicy?.triggerRescan('healpoint_stuck', {
                    videoId,
                    count: decision.healPointRepeatCount,
                    trigger: 'healpoint_stuck'
                });
            }
            return {
                shouldFailover: decision.shouldFailover,
                probationTriggered,
                repeatStuck: decision.repeatStuck
            };
        };
        const applyStallSkipDecision = (decision) => {
            if (!decision?.shouldSkip) return false;
            const videoId = decision.videoId;
            const monitorState = decision.monitorState;
            const now = decision.now;
            if (!monitorState) return true;
            if (decision.reason === 'backoff' && decision.backoff) {
                if (now - (monitorState.lastBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markBackoffLog(monitorState, now);
                    logDebug(LogEvents.tagged('BACKOFF', 'Stall skipped due to backoff'), {
                        videoId,
                        remainingMs: decision.backoff.remainingMs,
                        noHealPointCount: decision.backoff.noHealPointCount
                    });
                }
                return true;
            }
            if (decision.reason === 'buffer_starve' && decision.bufferStarve) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug(LogEvents.tagged('STARVE_SKIP', 'Stall skipped due to buffer starvation'), {
                        videoId,
                        remainingMs: decision.bufferStarve.remainingMs,
                        bufferAhead: decision.bufferStarve.bufferAhead !== null
                            ? decision.bufferStarve.bufferAhead.toFixed(3)
                            : null
                    });
                }
                return true;
            }
            if (decision.reason === 'play_backoff' && decision.playBackoff) {
                if (now - (monitorState.lastPlayBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    PlaybackStateStore.markPlayBackoffLog(monitorState, now);
                    logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Stall skipped due to play backoff'), {
                        videoId,
                        remainingMs: decision.playBackoff.remainingMs,
                        playErrorCount: decision.playBackoff.playErrorCount
                    });
                }
                return true;
            }
            if (decision.reason === 'self_recover' && decision.selfRecover) {
                if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastSelfRecoverSkipLogTime = now;
                    logDebug(LogEvents.tagged('SELF_RECOVER_SKIP', 'Stall skipped for self-recovery window'), {
                        videoId,
                        stalledForMs: decision.selfRecover.stalledForMs,
                        graceMs: decision.selfRecover.graceMs,
                        extraGraceMs: decision.selfRecover.extraGraceMs,
                        signals: decision.selfRecover.signals,
                        bufferAhead: decision.selfRecover.bufferAhead,
                        bufferStarved: decision.selfRecover.bufferStarved
                    });
                }
                return true;
            }
            return true;
        };

        return {
            applyNoHealPointDecision,
            applyPlayFailureDecision,
            applyStallSkipDecision
        };
    };

    return { create };
})();
