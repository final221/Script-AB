// --- FailoverManager ---
/**
 * Handles candidate failover attempts when healing fails.
 */
const FailoverManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;
        const resetBackoff = options.resetBackoff || (() => {});
        const picker = FailoverCandidatePicker.create({
            monitorsById,
            scoreVideo: candidateSelector?.scoreVideo
        });

        const state = {
            inProgress: false,
            timerId: null,
            lastAttemptTime: 0,
            fromId: null,
            toId: null,
            startTime: 0,
            baselineProgressTime: 0,
            recentFailures: new Map(),
            lastProbeTimes: new Map(),
            probeStats: new Map()
        };

        const resetFailover = (reason) => {
            if (state.timerId) {
                clearTimeout(state.timerId);
            }
            if (state.inProgress) {
                Logger.add(LogEvents.tagged('FAILOVER', 'Cleared'), {
                    reason,
                    from: state.fromId,
                    to: state.toId
                });
            }
            state.inProgress = false;
            state.timerId = null;
            state.fromId = null;
            state.toId = null;
            state.startTime = 0;
            state.baselineProgressTime = 0;
        };

        const attemptFailover = (fromVideoId, reason, monitorState) => {
            const now = Date.now();
            if (state.inProgress) {
                logDebug(LogEvents.tagged('FAILOVER_SKIP', 'Failover already in progress'), {
                    from: fromVideoId,
                    reason
                });
                return false;
            }
            if (now - state.lastAttemptTime < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
                logDebug(LogEvents.tagged('FAILOVER_SKIP', 'Failover cooldown active'), {
                    from: fromVideoId,
                    reason,
                    cooldownMs: CONFIG.stall.FAILOVER_COOLDOWN_MS,
                    lastAttemptAgoMs: now - state.lastAttemptTime
                });
                return false;
            }

            const excluded = new Set();
            for (const [videoId, failedAt] of state.recentFailures.entries()) {
                if (now - failedAt < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
                    excluded.add(videoId);
                } else {
                    state.recentFailures.delete(videoId);
                }
            }

            const candidate = picker.selectPreferred(fromVideoId, excluded);
            if (!candidate) {
                Logger.add(LogEvents.tagged('FAILOVER_SKIP', 'No trusted candidate available'), {
                    from: fromVideoId,
                    reason,
                    excluded: Array.from(excluded)
                });
                return false;
            }

            const toId = candidate.id;
            const entry = candidate.entry;

            state.inProgress = true;
            state.lastAttemptTime = now;
            state.fromId = fromVideoId;
            state.toId = toId;
            state.startTime = now;
            state.baselineProgressTime = entry.monitor.state.lastProgressTime || 0;

            candidateSelector.setActiveId(toId);

            Logger.add(LogEvents.tagged('FAILOVER', 'Switching to candidate'), {
                from: fromVideoId,
                to: toId,
                reason,
                stalledForMs: monitorState?.lastProgressTime ? (now - monitorState.lastProgressTime) : null,
                candidateState: VideoStateSnapshot.forLog(entry.video, toId)
            });

            const playPromise = entry.video?.play?.();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    Logger.add(LogEvents.tagged('FAILOVER_PLAY', 'Play rejected'), {
                        to: toId,
                        error: err?.name,
                        message: err?.message
                    });
                });
            }

            state.timerId = setTimeout(() => {
                if (!state.inProgress || state.toId !== toId) {
                    return;
                }

                const currentEntry = monitorsById.get(toId);
                const fromEntry = monitorsById.get(fromVideoId);
                const latestProgressTime = currentEntry?.monitor.state.lastProgressTime || 0;
                const progressed = currentEntry
                    && currentEntry.monitor.state.hasProgress
                    && latestProgressTime > state.baselineProgressTime
                    && latestProgressTime >= state.startTime;

                if (progressed) {
                    Logger.add(LogEvents.tagged('FAILOVER_SUCCESS', 'Candidate progressed'), {
                        from: fromVideoId,
                        to: toId,
                        progressDelayMs: latestProgressTime - state.startTime,
                        candidateState: VideoStateSnapshot.forLog(currentEntry.video, toId)
                    });
                    resetBackoff(currentEntry.monitor.state, 'failover_success');
                    state.recentFailures.delete(toId);
                } else {
                    Logger.add(LogEvents.tagged('FAILOVER_REVERT', 'Candidate did not progress'), {
                        from: fromVideoId,
                        to: toId,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS,
                        progressObserved: Boolean(currentEntry?.monitor.state.hasProgress),
                        candidateState: currentEntry ? VideoStateSnapshot.forLog(currentEntry.video, toId) : null
                    });
                    state.recentFailures.set(toId, Date.now());
                    if (fromEntry) {
                        candidateSelector.setActiveId(fromVideoId);
                    }
                }

                resetFailover('timeout');
            }, CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS);

            return true;
        };

        const shouldIgnoreStall = (videoId) => {
            if (state.inProgress && state.toId === videoId) {
                const elapsedMs = Date.now() - state.startTime;
                if (elapsedMs < CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS) {
                    logDebug(LogEvents.tagged('FAILOVER', 'Stall ignored during failover'), {
                        videoId,
                        elapsedMs,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS
                    });
                    return true;
                }
            }
            return false;
        };

        const onMonitorRemoved = (videoId) => {
            if (state.inProgress && (videoId === state.toId || videoId === state.fromId)) {
                resetFailover('monitor_removed');
            }
        };

        const getProbeStats = (videoId) => {
            let stats = state.probeStats.get(videoId);
            if (!stats) {
                stats = {
                    lastSummaryTime: 0,
                    counts: {
                        attempt: 0,
                        skipCooldown: 0,
                        skipNotReady: 0,
                        skipNotInDom: 0,
                        playRejected: 0
                    },
                    reasons: {},
                    lastError: null,
                    lastState: null,
                    lastReadyState: null,
                    lastHasSrc: null
                };
                state.probeStats.set(videoId, stats);
            }
            return stats;
        };

        const noteProbeReason = (stats, reason) => {
            if (!reason) return;
            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        };

        const maybeLogProbeSummary = (videoId, stats) => {
            const now = Date.now();
            const intervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
            if (now - stats.lastSummaryTime < intervalMs) {
                return;
            }

            const totalCount = Object.values(stats.counts).reduce((sum, value) => sum + value, 0);
            if (totalCount === 0) {
                stats.lastSummaryTime = now;
                return;
            }

            Logger.add(LogEvents.tagged('PROBE_SUMMARY', 'Probe activity'), {
                videoId,
                intervalMs,
                counts: stats.counts,
                reasons: stats.reasons,
                lastState: stats.lastState,
                lastReadyState: stats.lastReadyState,
                lastHasSrc: stats.lastHasSrc,
                lastError: stats.lastError
            });

            stats.lastSummaryTime = now;
            stats.counts = {
                attempt: 0,
                skipCooldown: 0,
                skipNotReady: 0,
                skipNotInDom: 0,
                playRejected: 0
            };
            stats.reasons = {};
            stats.lastError = null;
        };

        return {
            isActive: () => state.inProgress,
            resetFailover,
            attemptFailover,
            probeCandidate: (videoId, reason) => {
                const entry = monitorsById.get(videoId);
                const stats = getProbeStats(videoId);
                noteProbeReason(stats, reason);
                if (!entry) return false;
                const video = entry.video;
                if (!document.contains(video)) {
                    stats.counts.skipNotInDom += 1;
                    maybeLogProbeSummary(videoId, stats);
                    return false;
                }

                const now = Date.now();
                const cooldownMs = CONFIG.monitoring.PROBE_COOLDOWN_MS;
                const lastProbeTime = state.lastProbeTimes.get(videoId) || 0;
                if (lastProbeTime > 0 && now - lastProbeTime < cooldownMs) {
                    stats.counts.skipCooldown += 1;
                    maybeLogProbeSummary(videoId, stats);
                    return false;
                }

                const currentSrc = video.currentSrc || (video.getAttribute ? (video.getAttribute('src') || '') : '');
                const readyState = video.readyState;
                if (!currentSrc && readyState < 2) {
                    stats.counts.skipNotReady += 1;
                    stats.lastReadyState = readyState;
                    stats.lastHasSrc = Boolean(currentSrc);
                    maybeLogProbeSummary(videoId, stats);
                    return false;
                }

                state.lastProbeTimes.set(videoId, now);
                stats.counts.attempt += 1;
                stats.lastState = entry.monitor.state.state;
                stats.lastReadyState = readyState;
                stats.lastHasSrc = Boolean(currentSrc);
                maybeLogProbeSummary(videoId, stats);
                const promise = video?.play?.();
                if (promise && typeof promise.catch === 'function') {
                    promise.catch((err) => {
                        const innerStats = getProbeStats(videoId);
                        noteProbeReason(innerStats, reason);
                        innerStats.counts.playRejected += 1;
                        innerStats.lastError = {
                            error: err?.name,
                            message: err?.message
                        };
                        maybeLogProbeSummary(videoId, innerStats);
                    });
                }
                return true;
            },
            shouldIgnoreStall,
            onMonitorRemoved
        };
    };

    return { create };
})();
