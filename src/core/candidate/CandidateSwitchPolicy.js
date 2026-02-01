// --- CandidateSwitchPolicy ---
/**
 * Determines whether switching candidates should be allowed.
 */
const CandidateSwitchPolicy = (() => {
    const create = (options) => {
        const switchDelta = options.switchDelta;
        const minProgressMs = options.minProgressMs;
        const logDebug = options.logDebug || (() => {});

        const buildDecision = (action, detail) => ({
            action,
            ...detail
        });

        const shouldSwitch = (current, best, scores, reason) => {
            if (!current) {
                return { allow: true };
            }

            const delta = best.score - current.score;
            const currentScore = current.score;
            const currentBad = current.reasons.includes('fallback_src')
                || current.reasons.includes('ended')
                || current.reasons.includes('not_in_dom')
                || current.reasons.includes('reset')
                || current.reasons.includes('error_state');
            let suppression = null;
            let allow = true;

            if (!best.progressEligible && !currentBad) {
                allow = false;
                suppression = 'insufficient_progress';
            } else if (!currentBad && delta < switchDelta) {
                allow = false;
                suppression = 'score_delta';
            }

            if (!allow) {
                logDebug(LogEvents.tagged('CANDIDATE', 'Switch suppressed'), {
                    from: current.id,
                    to: best.id,
                    reason,
                    suppression,
                    delta,
                    currentScore,
                    bestScore: best.score,
                    bestProgressStreakMs: best.progressStreakMs,
                    minProgressMs,
                    scores
                });
            }

            return {
                allow,
                delta,
                currentScore,
                suppression
            };
        };

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
                return buildDecision('none', {
                    reason,
                    fromId: activeCandidateId,
                    toId: preferred?.id || null,
                    preferred,
                    scores
                });
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
                return buildDecision('fast_switch', baseDecision);
            }

            if (!preferred.progressEligible && !probationReady) {
                return buildDecision('stay', {
                    suppression: 'preferred_not_progress_eligible',
                    ...baseDecision
                });
            }

            if (!activeIsStalled) {
                return buildDecision('stay', {
                    suppression: 'active_not_stalled',
                    ...baseDecision
                });
            }

            if (baseDecision.currentTrusted && !preferred.trusted) {
                return buildDecision('stay', {
                    suppression: 'trusted_active_blocks_untrusted',
                    ...baseDecision
                });
            }

            if (!preferred.trusted && !probationActive) {
                return buildDecision('stay', {
                    suppression: 'untrusted_outside_probation',
                    ...baseDecision
                });
            }

            const preferredForPolicy = probationReady
                ? { ...preferred, progressEligible: true }
                : preferred;
            const policyDecision = shouldSwitch(current, preferredForPolicy, scores, reason);

            if (policyDecision.allow) {
                return buildDecision('switch', {
                    policyDecision,
                    preferredForPolicy,
                    ...baseDecision
                });
            }

            return buildDecision('stay', {
                suppression: policyDecision.suppression || 'score_delta',
                policyDecision,
                preferredForPolicy,
                ...baseDecision
            });
        };

        return { shouldSwitch, decide };
    };

    return { create };
})();
