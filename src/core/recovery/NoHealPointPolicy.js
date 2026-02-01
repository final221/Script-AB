// --- NoHealPointPolicy ---
/**
 * Handles no-heal-point scenarios, refreshes, and failover decisions.
 */
const NoHealPointPolicy = (() => {
    const create = (options = {}) => {
        const candidateSelector = options.candidateSelector;
        const monitorsById = options.monitorsById;
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

        const canEnterQuiet = (monitorState, decisionContext, nextNoHealPointCount) => {
            if (!monitorState) return false;
            if (nextNoHealPointCount < CONFIG.stall.NO_HEAL_POINT_QUIET_AFTER) {
                return false;
            }
            if (monitorState.noHealPointQuietUntil && decisionContext.now < monitorState.noHealPointQuietUntil) {
                return false;
            }
            if (monitorsById && monitorsById.size > 1) {
                return false;
            }
            if (!monitorState.bufferStarved) {
                return false;
            }
            const stalledForMs = decisionContext.stalledForMs;
            if (stalledForMs !== null && stalledForMs < CONFIG.stall.FAILOVER_AFTER_STALL_MS) {
                return false;
            }
            return true;
        };

        const buildDecision = (context, reason) => {
            const policyContext = RecoveryContext.buildPolicyContext(context, { reason });
            const monitorState = policyContext.monitorState;
            const decisionContext = policyContext.decisionContext;
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
            const quietEligible = canEnterQuiet(monitorState, decisionContext, nextNoHealPointCount);
            const quietUntil = quietEligible ? now + CONFIG.stall.NO_HEAL_POINT_QUIET_MS : 0;

            return RecoveryContext.buildDecision('no_heal_point', policyContext, {
                nextNoHealPointCount,
                shouldSetRefreshWindow,
                refreshUntil,
                shouldRescanNoBuffer: ranges.length === 0,
                quietEligible,
                quietUntil,
                stalledForMs: decisionContext.stalledForMs,
                bufferStarved: monitorState?.bufferStarved || false,
                probationEligible: Boolean(probationPolicy?.maybeTriggerProbation)
                    && monitorState
                    && nextNoHealPointCount >= CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS,
                shouldFailover,
                emergencyEligible: canEmergencySwitch(monitorState, nextNoHealPointCount, now),
                lastResortEligible: canLastResortSwitch(monitorState, nextNoHealPointCount, now),
                refreshEligible: canRefresh(monitorState, nextNoHealPointCount, now, refreshUntil)
            });
        };

        return {
            decide: buildDecision
        };
    };

    return { create };
})();
