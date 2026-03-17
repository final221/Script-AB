// @module CandidateSwitchPolicy
// @depends CandidateScorer
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

        const hasReason = (candidate, reason) => Boolean(candidate?.reasons?.includes(reason));

        const hasFreshProgress = (candidate) => (
            Number.isFinite(candidate?.progressAgoMs)
            && candidate.progressAgoMs <= CONFIG.monitoring.PROGRESS_RECENT_MS
        );

        const hasStrongIdentity = (candidate) => (
            hasReason(candidate, 'identity_origin_video')
            || hasReason(candidate, 'identity_recent_active')
            || hasReason(candidate, 'identity_origin_src_match')
        );

        const hasTrueOriginIdentity = (candidate) => (
            hasReason(candidate, 'identity_origin_video')
            || hasReason(candidate, 'identity_origin_src_match')
        );

        const isWeakProbationCandidate = (candidate) => (
            !candidate?.trusted
            && candidate?.trustReason === 'progress_stale'
            && Boolean(candidate?.vs?.paused)
            && !hasFreshProgress(candidate)
            && !hasStrongIdentity(candidate)
        );

        const evaluateEligibility = ({
            preferred,
            probationActive,
            probationReady,
            activeIsStalled,
            activeIsDegraded,
            currentTrusted,
            reason
        }) => {
            if (!preferred.progressEligible && !probationReady) {
                return { allow: false, suppression: 'preferred_not_progress_eligible', reason };
            }
            if (!activeIsStalled && !activeIsDegraded) {
                return { allow: false, suppression: 'active_not_stalled', reason };
            }
            if (currentTrusted && !preferred.trusted) {
                return { allow: false, suppression: 'trusted_active_blocks_untrusted', reason };
            }
            if (probationActive
                && reason === 'scan_buffer_starved'
                && isWeakProbationCandidate(preferred)) {
                return { allow: false, suppression: 'weak_probation_candidate', reason };
            }
            if (!preferred.trusted && !probationActive) {
                return { allow: false, suppression: 'untrusted_outside_probation', reason };
            }
            return { allow: true };
        };

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
                || current.reasons.includes('error_state')
                || current.reasons.includes('dead_candidate')
                || current.reasons.includes('degraded_sync');
            let suppression = null;
            let allow = true;

            if (!currentBad && delta < switchDelta) {
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
            const activeIsDegraded = Boolean(current?.reasons?.includes('degraded_sync')
                || current?.reasons?.includes('dead_candidate'));
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
                activeIsDegraded,
                activeNoHealPoints,
                activeStalledForMs,
                probationActive,
                probationReady,
                preferred,
                scores,
                currentTrusted: current ? current.trusted : false
            };

            const fastReturnAllowed = activeHealing
                && !baseDecision.currentTrusted
                && hasTrueOriginIdentity(preferred)
                && hasFreshProgress(preferred)
                && !preferred.vs.paused
                && preferred.vs.readyState >= CONFIG.monitoring.PROBATION_READY_STATE
                && preferred.progressStreakMs >= CONFIG.monitoring.PROBATION_MIN_PROGRESS_MS;

            if (fastReturnAllowed) {
                return buildDecision('fast_switch', {
                    fastSwitchKind: 'reclaim_origin',
                    ...baseDecision
                });
            }

            if (fastSwitchAllowed) {
                return buildDecision('fast_switch', {
                    fastSwitchKind: 'healing_dead_end',
                    ...baseDecision
                });
            }

            const eligibility = evaluateEligibility({
                preferred,
                probationActive,
                probationReady,
                activeIsStalled,
                activeIsDegraded,
                currentTrusted: baseDecision.currentTrusted,
                reason
            });
            if (!eligibility.allow) {
                return buildDecision('stay', {
                    suppression: eligibility.suppression,
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
