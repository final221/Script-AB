// --- CandidateSelector ---
/**
 * Scores and selects the best video candidate for healing.
 */
const CandidateSelector = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const logDebug = options.logDebug;
        const maxMonitors = options.maxMonitors;
        const minProgressMs = options.minProgressMs;
        const switchDelta = options.switchDelta;
        const isFallbackSource = options.isFallbackSource;

        let activeCandidateId = null;
        let lockChecker = null;
        let lastGoodCandidateId = null;
        const scorer = CandidateScorer.create({ minProgressMs, isFallbackSource });
        const switchPolicy = CandidateSwitchPolicy.create({
            switchDelta,
            minProgressMs,
            logDebug
        });

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const getActiveId = () => {
            if (!activeCandidateId && monitorsById.size > 0) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : monitorsById.keys().next().value;
                if (fallbackId) {
                    activeCandidateId = fallbackId;
                    Logger.add('[HEALER:CANDIDATE] Active video set', {
                        to: activeCandidateId,
                        reason: 'fallback'
                    });
                }
            }
            return activeCandidateId;
        };
        const setActiveId = (id) => {
            activeCandidateId = id;
        };

        const scoreVideo = (video, monitor, videoId) => scorer.score(video, monitor, videoId);
        const isTrustedCandidate = (result) => {
            if (!result.progressEligible) return false;
            const badReasons = ['fallback_src', 'ended', 'not_in_dom', 'reset', 'error_state', 'error'];
            return !badReasons.some(reason => result.reasons.includes(reason));
        };

        const evaluateCandidates = (reason) => {
            if (lockChecker && lockChecker()) {
                logDebug('[HEALER:CANDIDATE] Failover lock active', {
                    reason,
                    activeVideoId: activeCandidateId
                });
                return activeCandidateId ? { id: activeCandidateId } : null;
            }

            if (monitorsById.size === 0) {
                activeCandidateId = null;
                lastGoodCandidateId = null;
                return null;
            }

            let best = null;
            let current = null;
            let bestTrusted = null;
            const scores = [];

            if (activeCandidateId && monitorsById.has(activeCandidateId)) {
                const entry = monitorsById.get(activeCandidateId);
                const result = scoreVideo(entry.video, entry.monitor, activeCandidateId);
                current = {
                    id: activeCandidateId,
                    state: entry.monitor.state.state,
                    ...result
                };
                current.trusted = isTrustedCandidate(current);
            }

            for (const [videoId, entry] of monitorsById.entries()) {
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                const trusted = isTrustedCandidate(result);
                scores.push({
                    id: videoId,
                    score: result.score,
                    progressAgoMs: result.progressAgoMs,
                    progressStreakMs: result.progressStreakMs,
                    progressEligible: result.progressEligible,
                    paused: result.vs.paused,
                    readyState: result.vs.readyState,
                    currentSrc: result.vs.currentSrc,
                    state: entry.monitor.state.state,
                    reasons: result.reasons,
                    trusted
                });

                if (!best || result.score > best.score) {
                    best = { id: videoId, ...result, trusted };
                }
                if (trusted && (!bestTrusted || result.score > bestTrusted.score)) {
                    bestTrusted = { id: videoId, ...result, trusted };
                }
            }

            if (bestTrusted) {
                lastGoodCandidateId = bestTrusted.id;
            } else if (lastGoodCandidateId && !monitorsById.has(lastGoodCandidateId)) {
                lastGoodCandidateId = null;
            }

            const preferred = bestTrusted || best;

            if (!activeCandidateId || !monitorsById.has(activeCandidateId)) {
                const fallbackId = (lastGoodCandidateId && monitorsById.has(lastGoodCandidateId))
                    ? lastGoodCandidateId
                    : preferred?.id;
                if (fallbackId) {
                    Logger.add('[HEALER:CANDIDATE] Active video set', {
                        to: fallbackId,
                        reason: 'no_active',
                        scores
                    });
                    activeCandidateId = fallbackId;
                }
            }

            if (preferred && preferred.id !== activeCandidateId) {
                const activeState = current ? current.state : null;
                const activeIsStalled = !current || ['STALLED', 'RESET', 'ERROR'].includes(activeState);

                if (!preferred.progressEligible) {
                    logDebug('[HEALER:CANDIDATE] Switch suppressed', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'preferred_not_progress_eligible',
                        activeState,
                        scores
                    });
                    return preferred;
                }

                if (!activeIsStalled) {
                    logDebug('[HEALER:CANDIDATE] Switch suppressed', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'active_not_stalled',
                        activeState,
                        scores
                    });
                    return preferred;
                }

                const currentTrusted = current ? current.trusted : false;
                if (currentTrusted && !preferred.trusted) {
                    logDebug('[HEALER:CANDIDATE] Switch blocked by trust', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        currentTrusted,
                        preferredTrusted: preferred.trusted,
                        scores
                    });
                    return preferred;
                }

                const decision = switchPolicy.shouldSwitch(current, preferred, scores, reason);
                if (decision.allow) {
                    Logger.add('[HEALER:CANDIDATE] Active video switched', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        delta: decision.delta,
                        currentScore: decision.currentScore,
                        bestScore: preferred.score,
                        bestProgressStreakMs: preferred.progressStreakMs,
                        bestProgressEligible: preferred.progressEligible,
                        scores
                    });
                    activeCandidateId = preferred.id;
                }
            }

            return preferred;
        };

        const pruneMonitors = (excludeId, stopMonitoring) => {
            if (monitorsById.size <= maxMonitors) return;

            let worst = null;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                if (!worst || result.score < worst.score) {
                    worst = { id: videoId, entry, score: result.score };
                }
            }

            if (worst) {
                Logger.add('[HEALER:PRUNE] Stopped monitor due to cap', {
                    videoId: worst.id,
                    score: worst.score,
                    maxMonitors
                });
                stopMonitoring(worst.entry.video);
            }
        };

        return {
            evaluateCandidates,
            pruneMonitors,
            scoreVideo,
            getActiveId,
            setActiveId,
            setLockChecker
        };
    };

    return { create };
})();
