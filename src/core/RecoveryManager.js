// --- RecoveryManager ---
/**
 * Coordinates backoff and failover recovery strategies.
 */
const RecoveryManager = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const getVideoId = options.getVideoId;
        const logDebug = options.logDebug;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});

        const backoffManager = BackoffManager.create({ logDebug });
        const failoverManager = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug,
            resetBackoff: backoffManager.resetBackoff
        });
        const probeCandidate = failoverManager.probeCandidate;
        let lastProbationRescanAt = 0;

        const maybeTriggerProbation = (videoId, monitorState, trigger, count, threshold) => {
            if (!monitorState) return false;
            if (count < threshold) {
                return false;
            }
            const now = Date.now();
            if (now - lastProbationRescanAt < CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                return false;
            }
            lastProbationRescanAt = now;
            const reason = trigger || 'probation';
            candidateSelector.activateProbation(reason);
            onRescan(reason, {
                videoId,
                count,
                trigger: reason
            });
            return true;
        };

        const maybeTriggerRefresh = (videoId, monitorState, reason) => {
            if (!monitorState) return false;
            const now = Date.now();
            if ((monitorState.noHealPointCount || 0) < CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                return false;
            }
            const nextAllowed = monitorState.lastRefreshAt
                ? (monitorState.lastRefreshAt + CONFIG.stall.REFRESH_COOLDOWN_MS)
                : 0;
            if (now < nextAllowed) {
                return false;
            }
            monitorState.lastRefreshAt = now;
            logDebug('[HEALER:REFRESH] Refreshing video after repeated no-heal points', {
                videoId,
                reason,
                noHealPointCount: monitorState.noHealPointCount
            });
            monitorState.noHealPointCount = 0;
            onPersistentFailure(videoId, {
                reason,
                detail: 'no_heal_point'
            });
            return true;
        };

        const handleNoHealPoint = (video, monitorState, reason) => {
            const videoId = getVideoId(video);
            backoffManager.applyBackoff(videoId, monitorState, reason);
            maybeTriggerProbation(
                videoId,
                monitorState,
                reason,
                monitorState?.noHealPointCount || 0,
                CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS
            );

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            if (shouldFailover) {
                failoverManager.attemptFailover(videoId, reason, monitorState);
            }

            if (maybeTriggerRefresh(videoId, monitorState, reason)) {
                return;
            }
        };

        const resetPlayError = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.playErrorCount > 0 || monitorState.nextPlayHealAllowedTime > 0) {
                logDebug('[HEALER:PLAY_BACKOFF] Reset', {
                    reason,
                    previousPlayErrors: monitorState.playErrorCount,
                    previousNextPlayAllowedMs: monitorState.nextPlayHealAllowedTime
                        ? Math.max(monitorState.nextPlayHealAllowedTime - Date.now(), 0)
                        : 0,
                    previousHealPointRepeats: monitorState.healPointRepeatCount
                });
            }
            monitorState.playErrorCount = 0;
            monitorState.nextPlayHealAllowedTime = 0;
            monitorState.lastPlayErrorTime = 0;
            monitorState.lastPlayBackoffLogTime = 0;
            monitorState.lastHealPointKey = null;
            monitorState.healPointRepeatCount = 0;
        };

        const handlePlayFailure = (video, monitorState, detail = {}) => {
            if (!monitorState) return;
            const videoId = getVideoId(video);
            const now = Date.now();
            const lastErrorTime = monitorState.lastPlayErrorTime || 0;
            if (lastErrorTime > 0 && (now - lastErrorTime) > CONFIG.stall.PLAY_ERROR_DECAY_MS) {
                monitorState.playErrorCount = 0;
            }

            const count = (monitorState.playErrorCount || 0) + 1;
            const base = CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS;
            const max = CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.playErrorCount = count;
            monitorState.lastPlayErrorTime = now;
            monitorState.nextPlayHealAllowedTime = now + backoffMs;

            Logger.add('[HEALER:PLAY_BACKOFF] Play failed', {
                videoId,
                reason: detail.reason,
                error: detail.error,
                errorName: detail.errorName,
                playErrorCount: count,
                backoffMs,
                nextHealAllowedInMs: backoffMs,
                healRange: detail.healRange || null,
                healPointRepeatCount: detail.healPointRepeatCount || 0
            });

            const repeatCount = detail.healPointRepeatCount || 0;
            const repeatStuck = repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT;
            if (repeatStuck) {
                Logger.add('[HEALER:HEALPOINT_STUCK] Repeated heal point loop', {
                    videoId,
                    healRange: detail.healRange || null,
                    repeatCount,
                    errorName: detail.errorName,
                    error: detail.error
                });
            }

            const probationTriggered = maybeTriggerProbation(
                videoId,
                monitorState,
                detail.reason || 'play_error',
                count,
                CONFIG.stall.PROBATION_AFTER_PLAY_ERRORS
            );

            if (repeatStuck && !probationTriggered) {
                const nowMs = Date.now();
                if (nowMs - lastProbationRescanAt >= CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                    lastProbationRescanAt = nowMs;
                    candidateSelector.activateProbation('healpoint_stuck');
                    onRescan('healpoint_stuck', {
                        videoId,
                        count: repeatCount,
                        trigger: 'healpoint_stuck'
                    });
                }
            }

            const shouldFailover = monitorsById.size > 1
                && (count >= CONFIG.stall.FAILOVER_AFTER_PLAY_ERRORS || repeatStuck);

            if (probationTriggered || repeatStuck || shouldFailover) {
                const beforeActive = candidateSelector.getActiveId();
                candidateSelector.evaluateCandidates('play_error');
                const afterActive = candidateSelector.getActiveId();
                if (shouldFailover && afterActive === beforeActive) {
                    failoverManager.attemptFailover(videoId, detail.reason || 'play_error', monitorState);
                }
            }
        };

        const shouldSkipStall = (videoId, monitorState) => {
            const now = Date.now();
            if (failoverManager.shouldIgnoreStall(videoId)) {
                return true;
            }
            if (backoffManager.shouldSkip(videoId, monitorState)) {
                return true;
            }
            if (monitorState?.bufferStarveUntil && now < monitorState.bufferStarveUntil) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug('[HEALER:STARVE_SKIP] Stall skipped due to buffer starvation', {
                        videoId,
                        remainingMs: monitorState.bufferStarveUntil - now,
                        bufferAhead: monitorState.lastBufferAhead !== null
                            ? monitorState.lastBufferAhead.toFixed(3)
                            : null
                    });
                }
                return true;
            }
            if (monitorState?.nextPlayHealAllowedTime && now < monitorState.nextPlayHealAllowedTime) {
                if (now - (monitorState.lastPlayBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastPlayBackoffLogTime = now;
                    logDebug('[HEALER:PLAY_BACKOFF] Stall skipped due to play backoff', {
                        videoId,
                        remainingMs: monitorState.nextPlayHealAllowedTime - now,
                        playErrorCount: monitorState.playErrorCount
                    });
                }
                return true;
            }

            if (monitorState) {
                const lastProgress = monitorState.lastProgressTime || 0;
                const stalledForMs = lastProgress ? (now - lastProgress) : null;
                const graceMs = CONFIG.stall.SELF_RECOVER_GRACE_MS;
                const maxMs = CONFIG.stall.SELF_RECOVER_MAX_MS;

                if (stalledForMs !== null && (!maxMs || stalledForMs <= maxMs)) {
                    const signals = [];
                    const lastSrcChange = monitorState.lastSrcChangeTime || 0;
                    const lastReadyChange = monitorState.lastReadyStateChangeTime || 0;
                    const lastNetworkChange = monitorState.lastNetworkStateChangeTime || 0;
                    const lastBufferRangeChange = monitorState.lastBufferedLengthChangeTime || 0;
                    const lastBufferGrow = monitorState.lastBufferAheadIncreaseTime || 0;

                    if (lastSrcChange > lastProgress && (now - lastSrcChange) <= graceMs) {
                        signals.push('src_change');
                    }
                    if (lastReadyChange > lastProgress && (now - lastReadyChange) <= graceMs) {
                        signals.push('ready_state');
                    }
                    if (lastNetworkChange > lastProgress && (now - lastNetworkChange) <= graceMs) {
                        signals.push('network_state');
                    }
                    if (lastBufferRangeChange > lastProgress && (now - lastBufferRangeChange) <= graceMs) {
                        signals.push('buffer_ranges');
                    }
                    if (lastBufferGrow > lastProgress && (now - lastBufferGrow) <= graceMs) {
                        signals.push('buffer_growth');
                    }

                    if (signals.length > 0) {
                        if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                            monitorState.lastSelfRecoverSkipLogTime = now;
                            logDebug('[HEALER:SELF_RECOVER_SKIP] Stall skipped for self-recovery window', {
                                videoId,
                                stalledForMs,
                                graceMs,
                                signals,
                                bufferAhead: monitorState.lastBufferAhead,
                                bufferStarved: monitorState.bufferStarved || false
                            });
                        }
                        return true;
                    }
                }
            }
            return false;
        };

        return {
            isFailoverActive: () => failoverManager.isActive(),
            resetFailover: failoverManager.resetFailover,
            resetBackoff: backoffManager.resetBackoff,
            resetPlayError,
            handleNoHealPoint,
            handlePlayFailure,
            shouldSkipStall,
            probeCandidate,
            onMonitorRemoved: failoverManager.onMonitorRemoved
        };
    };

    return { create };
})();
