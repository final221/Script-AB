// --- RecoveryPolicy ---
/**
 * Centralized recovery/backoff policy logic.
 */
const RecoveryPolicy = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const candidateSelector = options.candidateSelector;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;

        const backoffManager = BackoffManager.create({ logDebug });
        let lastProbationRescanAt = 0;
        const noBufferRescanTimes = new Map();

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
            if (candidateSelector) {
                candidateSelector.activateProbation(reason);
            }
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
            logDebug(LogEvents.tagged('REFRESH', 'Refreshing video after repeated no-heal points'), {
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

        const handleNoHealPoint = (context, reason) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');

            backoffManager.applyBackoff(videoId, monitorState, reason);

            const ranges = MediaState.ranges(video);
            if (!ranges.length) {
                const now = Date.now();
                const lastNoBufferRescan = noBufferRescanTimes.get(videoId) || 0;
                if (now - lastNoBufferRescan >= CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                    noBufferRescanTimes.set(videoId, now);
                    if (candidateSelector) {
                        candidateSelector.activateProbation('no_buffer');
                    }
                    onRescan('no_buffer', {
                        videoId,
                        reason,
                        bufferRanges: 'none'
                    });
                }
            }

            const probationTriggered = maybeTriggerProbation(
                videoId,
                monitorState,
                reason,
                monitorState?.noHealPointCount || 0,
                CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS
            );

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById && monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            const refreshed = maybeTriggerRefresh(videoId, monitorState, reason);

            return {
                shouldFailover,
                refreshed,
                probationTriggered
            };
        };

        const resetPlayError = (monitorState, reason) => {
            if (!monitorState) return;
            if (monitorState.playErrorCount > 0 || monitorState.nextPlayHealAllowedTime > 0) {
                logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Reset'), {
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

        const handlePlayFailure = (context, detail = {}) => {
            const video = context.video;
            const monitorState = context.monitorState;
            if (!monitorState) return { shouldFailover: false, probationTriggered: false, repeatStuck: false };
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');
            const now = Date.now();
            const lastErrorTime = monitorState.lastPlayErrorTime || 0;
            if (lastErrorTime > 0 && (now - lastErrorTime) > CONFIG.stall.PLAY_ERROR_DECAY_MS) {
                monitorState.playErrorCount = 0;
            }

            const count = (monitorState.playErrorCount || 0) + 1;
            const isAbortError = detail?.errorName === 'AbortError'
                || (typeof detail?.error === 'string' && detail.error.toLowerCase().includes('aborted'));
            const base = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_BASE_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS;
            const max = isAbortError
                ? (CONFIG.stall.PLAY_ABORT_BACKOFF_MAX_MS || CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS)
                : CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS;
            const backoffMs = Math.min(base * count, max);

            monitorState.playErrorCount = count;
            monitorState.lastPlayErrorTime = now;
            monitorState.nextPlayHealAllowedTime = now + backoffMs;

            Logger.add(LogEvents.tagged('PLAY_BACKOFF', 'Play failed'), {
                videoId,
                reason: detail.reason,
                error: detail.error,
                errorName: detail.errorName,
                playErrorCount: count,
                backoffMs,
                abortBackoff: isAbortError,
                nextHealAllowedInMs: backoffMs,
                healRange: detail.healRange || null,
                healPointRepeatCount: detail.healPointRepeatCount || 0
            });

            const repeatCount = detail.healPointRepeatCount || 0;
            const repeatStuck = repeatCount >= CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT;
            if (repeatStuck) {
                Logger.add(LogEvents.tagged('HEALPOINT_STUCK', 'Repeated heal point loop'), {
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
                    if (candidateSelector) {
                        candidateSelector.activateProbation('healpoint_stuck');
                    }
                    onRescan('healpoint_stuck', {
                        videoId,
                        count: repeatCount,
                        trigger: 'healpoint_stuck'
                    });
                }
            }

            const shouldFailover = monitorsById && monitorsById.size > 1
                && (count >= CONFIG.stall.FAILOVER_AFTER_PLAY_ERRORS || repeatStuck);

            return {
                shouldFailover,
                probationTriggered,
                repeatStuck
            };
        };

        const shouldSkipStall = (context) => {
            const videoId = context.videoId;
            const monitorState = context.monitorState;
            const now = Date.now();
            if (backoffManager.shouldSkip(videoId, monitorState)) {
                return true;
            }
            if (monitorState?.bufferStarveUntil && now < monitorState.bufferStarveUntil) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug(LogEvents.tagged('STARVE_SKIP', 'Stall skipped due to buffer starvation'), {
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
                    logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Stall skipped due to play backoff'), {
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
                const baseGraceMs = CONFIG.stall.SELF_RECOVER_GRACE_MS;
                const allowExtraGrace = !monitorState.bufferStarved;
                const extraGraceMs = allowExtraGrace ? (CONFIG.stall.SELF_RECOVER_EXTRA_MS || 0) : 0;
                const maxGraceMs = CONFIG.stall.SELF_RECOVER_MAX_MS || 0;
                const extendedGraceMs = maxGraceMs
                    ? Math.min(baseGraceMs + extraGraceMs, maxGraceMs)
                    : baseGraceMs + extraGraceMs;
                const maxMs = CONFIG.stall.SELF_RECOVER_MAX_MS;

                if (stalledForMs !== null && (!maxMs || stalledForMs <= maxMs)) {
                    const signals = [];
                    const strongSignals = [];
                    const lastSrcChange = monitorState.lastSrcChangeTime || 0;
                    const lastReadyChange = monitorState.lastReadyStateChangeTime || 0;
                    const lastNetworkChange = monitorState.lastNetworkStateChangeTime || 0;
                    const lastBufferRangeChange = monitorState.lastBufferedLengthChangeTime || 0;
                    const lastBufferGrow = monitorState.lastBufferAheadIncreaseTime || 0;

                    const isWithin = (ts, windowMs) => (
                        ts > lastProgress && (now - ts) <= windowMs
                    );

                    if (isWithin(lastReadyChange, extendedGraceMs)) {
                        signals.push('ready_state');
                        strongSignals.push('ready_state');
                    }
                    if (isWithin(lastBufferGrow, extendedGraceMs)) {
                        signals.push('buffer_growth');
                        strongSignals.push('buffer_growth');
                    }
                    if (isWithin(lastSrcChange, baseGraceMs)) {
                        signals.push('src_change');
                    }
                    if (isWithin(lastNetworkChange, baseGraceMs)) {
                        signals.push('network_state');
                    }
                    if (isWithin(lastBufferRangeChange, baseGraceMs)) {
                        signals.push('buffer_ranges');
                    }

                    if (signals.length > 0) {
                        const graceMs = strongSignals.length > 0 ? extendedGraceMs : baseGraceMs;
                        if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                            monitorState.lastSelfRecoverSkipLogTime = now;
                            logDebug(LogEvents.tagged('SELF_RECOVER_SKIP', 'Stall skipped for self-recovery window'), {
                                videoId,
                                stalledForMs,
                                graceMs,
                                extraGraceMs: strongSignals.length > 0 ? extraGraceMs : 0,
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
            resetBackoff: backoffManager.resetBackoff,
            resetPlayError,
            handleNoHealPoint,
            handlePlayFailure,
            shouldSkipStall
        };
    };

    return { create };
})();
