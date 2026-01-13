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
        let probationUntil = 0;
        let probationReason = null;
        let lastDecisionLogTime = 0;
        let suppressionSummary = {
            lastLogTime: Date.now(),
            counts: {},
            lastSample: null
        };
        const scorer = CandidateScorer.create({ minProgressMs, isFallbackSource });
        const switchPolicy = CandidateSwitchPolicy.create({
            switchDelta,
            minProgressMs,
            logDebug
        });

        const setLockChecker = (fn) => {
            lockChecker = fn;
        };

        const activateProbation = (reason) => {
            const windowMs = CONFIG.monitoring.PROBATION_WINDOW_MS;
            probationUntil = Date.now() + windowMs;
            probationReason = reason || 'unknown';
            Logger.add('[HEALER:PROBATION] Window started', {
                reason: probationReason,
                windowMs
            });
        };

        const isProbationActive = () => {
            if (!probationUntil) return false;
            if (Date.now() <= probationUntil) {
                return true;
            }
            Logger.add('[HEALER:PROBATION] Window ended', {
                reason: probationReason
            });
            probationUntil = 0;
            probationReason = null;
            return false;
        };

        const shouldLogDecision = (reason) => (
            reason !== 'interval'
            || (Date.now() - lastDecisionLogTime) >= CONFIG.logging.ACTIVE_LOG_MS
        );

        const logDecision = (detail) => {
            if (!detail || !shouldLogDecision(detail.reason)) return;
            lastDecisionLogTime = Date.now();
            Logger.add('[HEALER:CANDIDATE_DECISION] Selection summary', detail);
        };

        const logSuppression = (detail) => {
            if (!detail) return;
            if (detail.reason !== 'interval') {
                logDebug('[HEALER:CANDIDATE] Switch suppressed', detail);
                return;
            }
            const cause = detail.cause || 'unknown';
            suppressionSummary.counts[cause] = (suppressionSummary.counts[cause] || 0) + 1;
            suppressionSummary.lastSample = {
                from: detail.from,
                to: detail.to,
                cause,
                reason: detail.reason,
                activeState: detail.activeState,
                probationActive: detail.probationActive
            };

            const now = Date.now();
            const windowMs = now - suppressionSummary.lastLogTime;
            if (windowMs < CONFIG.logging.SUPPRESSION_LOG_MS) {
                return;
            }
            const total = Object.values(suppressionSummary.counts)
                .reduce((sum, count) => sum + count, 0);
            if (total > 0) {
                Logger.add('[HEALER:SUPPRESSION_SUMMARY] Switch suppressed summary', {
                    windowMs,
                    total,
                    byCause: suppressionSummary.counts,
                    lastSample: suppressionSummary.lastSample
                });
            }
            suppressionSummary = {
                lastLogTime: now,
                counts: {},
                lastSample: null
            };
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
                const trustInfo = CandidateTrust.getTrustInfo(result);
                current = {
                    id: activeCandidateId,
                    state: entry.monitor.state.state,
                    ...result
                };
                current.trusted = trustInfo.trusted;
                current.trustReason = trustInfo.reason;
            }

            for (const [videoId, entry] of monitorsById.entries()) {
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                const trustInfo = CandidateTrust.getTrustInfo(result);
                const trusted = trustInfo.trusted;
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
                    trusted,
                    trustReason: trustInfo.reason
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
                const activeIsStalled = !current || ['STALLED', 'RESET', 'ERROR', 'ENDED'].includes(activeState);
                const probationActive = isProbationActive();
                const probationProgressOk = preferred.progressStreakMs >= CONFIG.monitoring.PROBATION_MIN_PROGRESS_MS;
                const probationReady = probationActive
                    && probationProgressOk
                    && (preferred.vs.readyState >= CONFIG.monitoring.PROBATION_READY_STATE
                        || preferred.vs.currentSrc);

                if (!preferred.progressEligible && !probationReady) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'preferred_not_progress_eligible',
                        activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'preferred_not_progress_eligible',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive,
                        probationReady
                    });
                    return preferred;
                }

                if (!activeIsStalled) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'active_not_stalled',
                        activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'active_not_stalled',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                const currentTrusted = current ? current.trusted : false;
                if (currentTrusted && !preferred.trusted) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'trusted_active_blocks_untrusted',
                        activeState,
                        probationActive,
                        currentTrusted,
                        preferredTrusted: preferred.trusted,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'trusted_active_blocks_untrusted',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                if (!preferred.trusted && !probationActive) {
                    logSuppression({
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        cause: 'untrusted_outside_probation',
                        activeState,
                        probationActive,
                        scores
                    });
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: 'untrusted_outside_probation',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                    return preferred;
                }

                const preferredForPolicy = probationReady
                    ? { ...preferred, progressEligible: true }
                    : preferred;
                const decision = switchPolicy.shouldSwitch(current, preferredForPolicy, scores, reason);
                if (decision.allow) {
                    const fromId = activeCandidateId;
                    Logger.add('[HEALER:CANDIDATE] Active video switched', {
                        from: activeCandidateId,
                        to: preferred.id,
                        reason,
                        delta: decision.delta,
                        currentScore: decision.currentScore,
                        bestScore: preferred.score,
                        bestProgressStreakMs: preferred.progressStreakMs,
                        bestProgressEligible: preferred.progressEligible,
                        probationActive,
                        scores
                    });
                    activeCandidateId = preferred.id;
                    logDecision({
                        reason,
                        action: 'switch',
                        from: fromId,
                        to: activeCandidateId,
                        activeState,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                } else {
                    logDecision({
                        reason,
                        action: 'stay',
                        suppression: decision.suppression || 'score_delta',
                        activeId: activeCandidateId,
                        activeState,
                        preferredId: preferred.id,
                        preferredScore: preferred.score,
                        preferredProgressEligible: preferred.progressEligible,
                        preferredTrusted: preferred.trusted,
                        probationActive
                    });
                }
            }

            return preferred;
        };

        const pruneMonitors = (excludeId, stopMonitoring) => {
            if (monitorsById.size <= maxMonitors) return;

            const protectedIds = new Set();
            if (activeCandidateId) protectedIds.add(activeCandidateId);
            if (lastGoodCandidateId) protectedIds.add(lastGoodCandidateId);

            let worst = null;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                if (protectedIds.has(videoId)) continue;
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
            } else {
                logDebug('[HEALER:PRUNE_SKIP] All candidates protected', {
                    protected: Array.from(protectedIds),
                    maxMonitors,
                    totalMonitors: monitorsById.size
                });
            }
        };

        return {
            evaluateCandidates,
            pruneMonitors,
            scoreVideo,
            getActiveId,
            setActiveId,
            setLockChecker,
            activateProbation,
            isProbationActive
        };
    };

    return { create };
})();
