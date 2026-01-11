// --- RecoveryManager ---
/**
 * Handles backoff and failover recovery strategies.
 */
const RecoveryManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;

        const state = {
            inProgress: false,
            timerId: null,
            lastAttemptTime: 0,
            fromId: null,
            toId: null,
            startTime: 0,
            baselineProgressTime: 0
        };

        const getVideoIndex = (videoId) => {
            const match = /video-(\d+)/.exec(videoId);
            return match ? Number(match[1]) : -1;
        };

        const resetFailover = (reason) => {
            if (state.timerId) {
                clearTimeout(state.timerId);
            }
            if (state.inProgress) {
                Logger.add('[HEALER:FAILOVER] Cleared', {
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

        const resetBackoff = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.noHealPointCount > 0 || monitorState.nextHealAllowedTime > 0) {
                logDebug('[HEALER:BACKOFF] Reset', {
                    reason,
                    previousNoHealPoints: monitorState.noHealPointCount,
                    previousNextHealAllowedMs: monitorState.nextHealAllowedTime
                        ? Math.max(monitorState.nextHealAllowedTime - Date.now(), 0)
                        : 0
                });
            }
            monitorState.noHealPointCount = 0;
            monitorState.nextHealAllowedTime = 0;
        };

        const applyBackoff = (videoId, monitorState, reason) => {
            if (!monitorState) return;
            const count = (monitorState.noHealPointCount || 0) + 1;
            const base = CONFIG.stall.NO_HEAL_POINT_BACKOFF_BASE_MS;
            const max = CONFIG.stall.NO_HEAL_POINT_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.noHealPointCount = count;
            monitorState.nextHealAllowedTime = Date.now() + backoffMs;

            Logger.add('[HEALER:BACKOFF] No heal point', {
                videoId,
                reason,
                noHealPointCount: count,
                backoffMs,
                nextHealAllowedInMs: backoffMs
            });
        };

        const selectNewestCandidate = (excludeId) => {
            let newest = null;
            let newestIndex = -1;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                const idx = getVideoIndex(videoId);
                if (idx > newestIndex) {
                    newestIndex = idx;
                    newest = { id: videoId, entry };
                }
            }
            return newest;
        };

        const attemptFailover = (fromVideoId, reason, monitorState) => {
            const now = Date.now();
            if (state.inProgress) {
                logDebug('[HEALER:FAILOVER_SKIP] Failover already in progress', {
                    from: fromVideoId,
                    reason
                });
                return false;
            }
            if (now - state.lastAttemptTime < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
                logDebug('[HEALER:FAILOVER_SKIP] Failover cooldown active', {
                    from: fromVideoId,
                    reason,
                    cooldownMs: CONFIG.stall.FAILOVER_COOLDOWN_MS,
                    lastAttemptAgoMs: now - state.lastAttemptTime
                });
                return false;
            }

            const candidate = selectNewestCandidate(fromVideoId);
            if (!candidate) {
                logDebug('[HEALER:FAILOVER_SKIP] No candidate available', {
                    from: fromVideoId,
                    reason
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

            Logger.add('[HEALER:FAILOVER] Switching to candidate', {
                from: fromVideoId,
                to: toId,
                reason,
                stalledForMs: monitorState?.lastProgressTime ? (now - monitorState.lastProgressTime) : null,
                candidateState: VideoState.get(entry.video, toId)
            });

            const playPromise = entry.video?.play?.();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    Logger.add('[HEALER:FAILOVER_PLAY] Play rejected', {
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
                    Logger.add('[HEALER:FAILOVER_SUCCESS] Candidate progressed', {
                        from: fromVideoId,
                        to: toId,
                        progressDelayMs: latestProgressTime - state.startTime,
                        candidateState: VideoState.get(currentEntry.video, toId)
                    });
                    resetBackoff(currentEntry.monitor.state, 'failover_success');
                } else {
                    Logger.add('[HEALER:FAILOVER_REVERT] Candidate did not progress', {
                        from: fromVideoId,
                        to: toId,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS,
                        progressObserved: Boolean(currentEntry?.monitor.state.hasProgress),
                        candidateState: currentEntry ? VideoState.get(currentEntry.video, toId) : null
                    });
                    if (fromEntry) {
                        candidateSelector.setActiveId(fromVideoId);
                    }
                }

                resetFailover('timeout');
            }, CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS);

            return true;
        };

        const handleNoHealPoint = (video, monitorState, reason) => {
            const videoId = getVideoId(video);
            applyBackoff(videoId, monitorState, reason);

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            if (shouldFailover) {
                attemptFailover(videoId, reason, monitorState);
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            const now = Date.now();
            if (state.inProgress && state.toId === videoId) {
                const elapsedMs = now - state.startTime;
                if (elapsedMs < CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS) {
                    logDebug('[HEALER:FAILOVER] Stall ignored during failover', {
                        videoId,
                        elapsedMs,
                        timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS
                    });
                    return true;
                }
            }

            if (monitorState?.nextHealAllowedTime && now < monitorState.nextHealAllowedTime) {
                if (now - (monitorState.lastBackoffLogTime || 0) > 5000) {
                    monitorState.lastBackoffLogTime = now;
                    logDebug('[HEALER:BACKOFF] Stall skipped due to backoff', {
                        videoId,
                        remainingMs: monitorState.nextHealAllowedTime - now,
                        noHealPointCount: monitorState.noHealPointCount
                    });
                }
                return true;
            }

            return false;
        };

        const onMonitorRemoved = (videoId) => {
            if (state.inProgress && (videoId === state.toId || videoId === state.fromId)) {
                resetFailover('monitor_removed');
            }
        };

        return {
            isFailoverActive: () => state.inProgress,
            resetFailover,
            resetBackoff,
            handleNoHealPoint,
            shouldSkipStall,
            onMonitorRemoved
        };
    };

    return { create };
})();
