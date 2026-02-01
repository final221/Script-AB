// --- NoHealPointPolicy ---
/**
 * Handles no-heal-point scenarios, refreshes, and failover decisions.
 */
const NoHealPointPolicy = (() => {
    const create = (options = {}) => {
        const backoffManager = options.backoffManager;
        const candidateSelector = options.candidateSelector;
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const logDebug = options.logDebug || (() => {});
        const probationPolicy = options.probationPolicy;

        const canEmergencySwitch = (monitorState, nextNoHealPointCount, now) => {
            if (!candidateSelector || typeof candidateSelector.selectEmergencyCandidate !== 'function') {
                return false;
            }
            if (!CONFIG.stall.NO_HEAL_POINT_EMERGENCY_SWITCH) {
                return false;
            }
            if (!monitorState) return false;
            if (nextNoHealPointCount < CONFIG.stall.NO_HEAL_POINT_EMERGENCY_AFTER) {
                return false;
            }
            const lastSwitch = monitorState.lastEmergencySwitchAt || 0;
            return (now - lastSwitch) >= CONFIG.stall.NO_HEAL_POINT_EMERGENCY_COOLDOWN_MS;
        };

        const canLastResortSwitch = (monitorState, nextNoHealPointCount, now) => {
            if (!CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_SWITCH) {
                return false;
            }
            if (!monitorState) return false;
            if (nextNoHealPointCount < CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_AFTER) {
                return false;
            }
            if (CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_STARVED && !monitorState.bufferStarved) {
                return false;
            }
            if (!monitorsById || monitorsById.size < 2) {
                return false;
            }
            return canEmergencySwitch(monitorState, nextNoHealPointCount, now);
        };

        const canRefresh = (monitorState, nextNoHealPointCount, now, refreshUntil) => {
            if (!monitorState) return false;
            if (nextNoHealPointCount < CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                return false;
            }
            if (refreshUntil && now < refreshUntil) {
                return false;
            }
            const nextAllowed = monitorState.lastRefreshAt
                ? (monitorState.lastRefreshAt + CONFIG.stall.REFRESH_COOLDOWN_MS)
                : 0;
            return now >= nextAllowed;
        };

        const applyEmergencySwitch = (monitorState, reason, now, options = {}) => {
            if (!monitorState || !candidateSelector || typeof candidateSelector.selectEmergencyCandidate !== 'function') {
                return false;
            }
            const switched = candidateSelector.selectEmergencyCandidate(reason, options);
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

        const buildDecision = (context, reason) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');
            const decisionContext = context.getDecisionContext
                ? context.getDecisionContext()
                : RecoveryContext.buildDecisionContext(context);
            const now = decisionContext.now;
            const ranges = decisionContext.ranges;
            const nextNoHealPointCount = monitorState ? (monitorState.noHealPointCount || 0) + 1 : 0;
            const shouldSetRefreshWindow = monitorState
                && nextNoHealPointCount >= CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS
                && ranges.length
                && decisionContext.headroom < CONFIG.recovery.MIN_HEAL_HEADROOM_S
                && decisionContext.hasSrc
                && decisionContext.readyState >= CONFIG.stall.NO_HEAL_POINT_REFRESH_MIN_READY_STATE
                && !monitorState.noHealPointRefreshUntil;
            const refreshUntil = monitorState?.noHealPointRefreshUntil
                || (shouldSetRefreshWindow ? now + CONFIG.stall.NO_HEAL_POINT_REFRESH_DELAY_MS : 0);
            const shouldFailover = monitorsById && monitorsById.size > 1
                && (nextNoHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (decisionContext.stalledForMs !== null
                        && decisionContext.stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            return {
                videoId,
                monitorState,
                reason,
                now,
                ranges,
                nextNoHealPointCount,
                shouldSetRefreshWindow,
                refreshUntil,
                shouldRescanNoBuffer: ranges.length === 0,
                probationEligible: Boolean(probationPolicy?.maybeTriggerProbation)
                    && monitorState
                    && nextNoHealPointCount >= CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS,
                shouldFailover,
                emergencyEligible: canEmergencySwitch(monitorState, nextNoHealPointCount, now),
                lastResortEligible: canLastResortSwitch(monitorState, nextNoHealPointCount, now),
                refreshEligible: canRefresh(monitorState, nextNoHealPointCount, now, refreshUntil)
            };
        };

        const applyDecision = (decision) => {
            const videoId = decision.videoId;
            const monitorState = decision.monitorState;
            const reason = decision.reason;
            const now = decision.now;

            backoffManager.applyBackoff(videoId, monitorState, reason);

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

        const handleNoHealPoint = (context, reason) => (
            applyDecision(buildDecision(context, reason))
        );

        return {
            handleNoHealPoint
        };
    };

    return { create };
})();
