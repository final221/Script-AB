// --- CandidateDecision ---
/**
 * Builds candidate switch decisions from scoring + policy inputs.
 */
const CandidateDecision = (() => {
    const create = (options = {}) => {
        const switchPolicy = options.switchPolicy;

        const decide = ({
            now,
            current,
            preferred,
            activeCandidateId,
            probationActive,
            scores,
            reason
        }) => {
            if (!preferred || preferred.id === activeCandidateId) {
                return {
                    action: 'none',
                    reason,
                    fromId: activeCandidateId,
                    toId: preferred?.id || null,
                    preferred,
                    scores
                };
            }

            const activeState = current ? current.state : null;
            const activeMonitorState = current ? current.monitorState : null;
            const activeNoHealPoints = activeMonitorState?.noHealPointCount || 0;
            const activeStalledForMs = activeMonitorState?.lastProgressTime
                ? (now - activeMonitorState.lastProgressTime)
                : null;
            const activeHealing = activeState === MonitorStates.HEALING;
            const activeIsStalled = !current || [
                MonitorStates.STALLED,
                MonitorStates.RESET,
                MonitorStates.ERROR,
                MonitorStates.ENDED
            ].includes(activeState);
            const probationProgressOk = preferred.progressStreakMs >= CONFIG.monitoring.PROBATION_MIN_PROGRESS_MS;
            const probationReady = probationActive
                && probationProgressOk
                && (preferred.vs.readyState >= CONFIG.monitoring.PROBATION_READY_STATE
                    || preferred.vs.currentSrc);

            const fastSwitchAllowed = activeHealing
                && preferred.trusted
                && preferred.progressEligible
                && preferred.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS
                && (activeNoHealPoints >= CONFIG.stall.FAST_SWITCH_AFTER_NO_HEAL_POINTS
                    || (activeStalledForMs !== null
                        && activeStalledForMs >= CONFIG.stall.FAST_SWITCH_AFTER_STALL_MS));

            const baseDecision = {
                reason,
                fromId: activeCandidateId,
                toId: preferred.id,
                activeState,
                activeIsStalled,
                activeNoHealPoints,
                activeStalledForMs,
                probationActive,
                probationReady,
                preferred,
                scores,
                currentTrusted: current ? current.trusted : false
            };

            if (fastSwitchAllowed) {
                return {
                    action: 'fast_switch',
                    ...baseDecision
                };
            }

            if (!preferred.progressEligible && !probationReady) {
                return {
                    action: 'stay',
                    suppression: 'preferred_not_progress_eligible',
                    ...baseDecision
                };
            }

            if (!activeIsStalled) {
                return {
                    action: 'stay',
                    suppression: 'active_not_stalled',
                    ...baseDecision
                };
            }

            if (baseDecision.currentTrusted && !preferred.trusted) {
                return {
                    action: 'stay',
                    suppression: 'trusted_active_blocks_untrusted',
                    ...baseDecision
                };
            }

            if (!preferred.trusted && !probationActive) {
                return {
                    action: 'stay',
                    suppression: 'untrusted_outside_probation',
                    ...baseDecision
                };
            }

            const preferredForPolicy = probationReady
                ? { ...preferred, progressEligible: true }
                : preferred;
            const policyDecision = switchPolicy.shouldSwitch(current, preferredForPolicy, scores, reason);

            if (policyDecision.allow) {
                return {
                    action: 'switch',
                    policyDecision,
                    preferredForPolicy,
                    ...baseDecision
                };
            }

            return {
                action: 'stay',
                suppression: policyDecision.suppression || 'score_delta',
                policyDecision,
                preferredForPolicy,
                ...baseDecision
            };
        };

        return { decide };
    };

    return { create };
})();
