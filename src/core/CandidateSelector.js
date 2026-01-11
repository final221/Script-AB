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
        const scorer = CandidateScorer.create({ minProgressMs, isFallbackSource });

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const getActiveId = () => activeCandidateId;
        const setActiveId = (id) => {
            activeCandidateId = id;
        };

        const scoreVideo = (video, monitor, videoId) => scorer.score(video, monitor, videoId);

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
                return null;
            }

            let best = null;
            let current = null;
            const scores = [];

            if (activeCandidateId && monitorsById.has(activeCandidateId)) {
                const entry = monitorsById.get(activeCandidateId);
                current = { id: activeCandidateId, ...scoreVideo(entry.video, entry.monitor, activeCandidateId) };
            }

            for (const [videoId, entry] of monitorsById.entries()) {
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                scores.push({
                    id: videoId,
                    score: result.score,
                    progressAgoMs: result.progressAgoMs,
                    progressStreakMs: result.progressStreakMs,
                    progressEligible: result.progressEligible,
                    paused: result.vs.paused,
                    readyState: result.vs.readyState,
                    currentSrc: result.vs.currentSrc,
                    reasons: result.reasons
                });

                if (!best || result.score > best.score) {
                    best = { id: videoId, ...result };
                }
            }

            if (best && best.id !== activeCandidateId) {
                let allowSwitch = true;
                let delta = null;
                let currentScore = null;
                let suppression = null;

                if (current) {
                    delta = best.score - current.score;
                    currentScore = current.score;
                    const currentBad = current.reasons.includes('fallback_src')
                        || current.reasons.includes('ended')
                        || current.reasons.includes('not_in_dom')
                        || current.reasons.includes('reset')
                        || current.reasons.includes('error_state');
                    if (!best.progressEligible && !currentBad) {
                        allowSwitch = false;
                        suppression = 'insufficient_progress';
                    } else if (!currentBad && delta < switchDelta) {
                        allowSwitch = false;
                        suppression = 'score_delta';
                    }
                }

                if (!allowSwitch) {
                    logDebug('[HEALER:CANDIDATE] Switch suppressed', {
                        from: activeCandidateId,
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

                if (allowSwitch) {
                    Logger.add('[HEALER:CANDIDATE] Active video switched', {
                        from: activeCandidateId,
                        to: best.id,
                        reason,
                        delta,
                        currentScore,
                        bestScore: best.score,
                        bestProgressStreakMs: best.progressStreakMs,
                        bestProgressEligible: best.progressEligible,
                        scores
                    });
                    activeCandidateId = best.id;
                }
            }

            return best;
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
