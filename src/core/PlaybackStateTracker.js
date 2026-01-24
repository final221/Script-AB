// --- PlaybackStateTracker ---
/**
 * Shared playback state tracking for PlaybackMonitor.
 */
const PlaybackStateTracker = (() => {
    const PROGRESS_EPSILON = 0.05;

    const defineAlias = (target, key, path) => {
        Object.defineProperty(target, key, {
            configurable: true,
            get: () => path.reduce((ref, segment) => ref[segment], target),
            set: (value) => {
                let ref = target;
                for (let i = 0; i < path.length - 1; i++) {
                    ref = ref[path[i]];
                }
                ref[path[path.length - 1]] = value;
            }
        });
    };

    const applyAliases = (target, map) => {
        Object.entries(map).forEach(([key, path]) => defineAlias(target, key, path));
    };

    const create = (video, videoId, logDebug) => {
        const state = {
            status: {
                value: 'PLAYING'
            },
            progress: {
                lastProgressTime: 0,
                lastTime: video.currentTime,
                progressStartTime: null,
                progressStreakMs: 0,
                progressEligible: false,
                hasProgress: false,
                firstSeenTime: Date.now(),
                firstReadyTime: 0,
                initialProgressTimeoutLogged: false,
                initLogEmitted: false
            },
            heal: {
                noHealPointCount: 0,
                nextHealAllowedTime: 0,
                playErrorCount: 0,
                nextPlayHealAllowedTime: 0,
                lastPlayErrorTime: 0,
                lastPlayBackoffLogTime: 0,
                lastHealPointKey: null,
                healPointRepeatCount: 0,
                lastBackoffLogTime: 0,
                lastHealAttemptTime: 0,
                lastHealDeferralLogTime: 0,
                lastRefreshAt: 0
            },
            events: {
                lastWatchdogLogTime: 0,
                lastNonActiveEventLogTime: 0,
                nonActiveEventCounts: {},
                lastActiveEventLogTime: 0,
                lastActiveEventSummaryTime: 0,
                activeEventCounts: {}
            },
            media: {
                lastSrc: video.currentSrc || video.getAttribute('src') || '',
                lastSrcAttr: video.getAttribute ? (video.getAttribute('src') || '') : '',
                lastReadyState: video.readyState,
                lastNetworkState: video.networkState,
                lastSrcChangeTime: 0,
                lastReadyStateChangeTime: 0,
                lastNetworkStateChangeTime: 0,
                lastBufferedLengthChangeTime: 0,
                lastBufferedLength: (() => {
                    try {
                        return video.buffered ? video.buffered.length : 0;
                    } catch (error) {
                        return 0;
                    }
                })(),
                mediaStateVerboseLogged: false
            },
            stall: {
                lastStallEventTime: 0,
                pauseFromStall: false,
                stallStartTime: 0,
                bufferStarvedSince: 0,
                bufferStarved: false,
                bufferStarveUntil: 0,
                lastBufferStarveLogTime: 0,
                lastBufferStarveSkipLogTime: 0,
                lastBufferStarveRescanTime: 0,
                lastBufferAhead: null,
                lastBufferAheadUpdateTime: 0,
                lastBufferAheadIncreaseTime: 0,
                lastSelfRecoverSkipLogTime: 0,
                lastAdGapSignatureLogTime: 0,
                lastResourceWindowLogTime: 0
            },
            sync: {
                lastSyncWallTime: 0,
                lastSyncMediaTime: 0,
                lastSyncLogTime: 0
            },
            reset: {
                resetPendingAt: 0,
                resetPendingReason: null,
                resetPendingType: null,
                resetPendingCallback: null
            },
            catchUp: {
                catchUpTimeoutId: null,
                catchUpAttempts: 0,
                lastCatchUpTime: 0
            }
        };

        applyAliases(state, {
            state: ['status', 'value'],
            lastProgressTime: ['progress', 'lastProgressTime'],
            lastTime: ['progress', 'lastTime'],
            progressStartTime: ['progress', 'progressStartTime'],
            progressStreakMs: ['progress', 'progressStreakMs'],
            progressEligible: ['progress', 'progressEligible'],
            hasProgress: ['progress', 'hasProgress'],
            firstSeenTime: ['progress', 'firstSeenTime'],
            firstReadyTime: ['progress', 'firstReadyTime'],
            initialProgressTimeoutLogged: ['progress', 'initialProgressTimeoutLogged'],
            initLogEmitted: ['progress', 'initLogEmitted'],
            noHealPointCount: ['heal', 'noHealPointCount'],
            nextHealAllowedTime: ['heal', 'nextHealAllowedTime'],
            playErrorCount: ['heal', 'playErrorCount'],
            nextPlayHealAllowedTime: ['heal', 'nextPlayHealAllowedTime'],
            lastPlayErrorTime: ['heal', 'lastPlayErrorTime'],
            lastPlayBackoffLogTime: ['heal', 'lastPlayBackoffLogTime'],
            lastHealPointKey: ['heal', 'lastHealPointKey'],
            healPointRepeatCount: ['heal', 'healPointRepeatCount'],
            lastBackoffLogTime: ['heal', 'lastBackoffLogTime'],
            lastHealAttemptTime: ['heal', 'lastHealAttemptTime'],
            lastHealDeferralLogTime: ['heal', 'lastHealDeferralLogTime'],
            lastRefreshAt: ['heal', 'lastRefreshAt'],
            lastWatchdogLogTime: ['events', 'lastWatchdogLogTime'],
            lastNonActiveEventLogTime: ['events', 'lastNonActiveEventLogTime'],
            nonActiveEventCounts: ['events', 'nonActiveEventCounts'],
            lastActiveEventLogTime: ['events', 'lastActiveEventLogTime'],
            lastActiveEventSummaryTime: ['events', 'lastActiveEventSummaryTime'],
            activeEventCounts: ['events', 'activeEventCounts'],
            lastSrc: ['media', 'lastSrc'],
            lastSrcAttr: ['media', 'lastSrcAttr'],
            lastReadyState: ['media', 'lastReadyState'],
            lastNetworkState: ['media', 'lastNetworkState'],
            lastSrcChangeTime: ['media', 'lastSrcChangeTime'],
            lastReadyStateChangeTime: ['media', 'lastReadyStateChangeTime'],
            lastNetworkStateChangeTime: ['media', 'lastNetworkStateChangeTime'],
            lastBufferedLengthChangeTime: ['media', 'lastBufferedLengthChangeTime'],
            lastBufferedLength: ['media', 'lastBufferedLength'],
            mediaStateVerboseLogged: ['media', 'mediaStateVerboseLogged'],
            lastStallEventTime: ['stall', 'lastStallEventTime'],
            pauseFromStall: ['stall', 'pauseFromStall'],
            stallStartTime: ['stall', 'stallStartTime'],
            bufferStarvedSince: ['stall', 'bufferStarvedSince'],
            bufferStarved: ['stall', 'bufferStarved'],
            bufferStarveUntil: ['stall', 'bufferStarveUntil'],
            lastBufferStarveLogTime: ['stall', 'lastBufferStarveLogTime'],
            lastBufferStarveSkipLogTime: ['stall', 'lastBufferStarveSkipLogTime'],
            lastBufferStarveRescanTime: ['stall', 'lastBufferStarveRescanTime'],
            lastBufferAhead: ['stall', 'lastBufferAhead'],
            lastBufferAheadUpdateTime: ['stall', 'lastBufferAheadUpdateTime'],
            lastBufferAheadIncreaseTime: ['stall', 'lastBufferAheadIncreaseTime'],
            lastSelfRecoverSkipLogTime: ['stall', 'lastSelfRecoverSkipLogTime'],
            lastAdGapSignatureLogTime: ['stall', 'lastAdGapSignatureLogTime'],
            lastResourceWindowLogTime: ['stall', 'lastResourceWindowLogTime'],
            lastSyncWallTime: ['sync', 'lastSyncWallTime'],
            lastSyncMediaTime: ['sync', 'lastSyncMediaTime'],
            lastSyncLogTime: ['sync', 'lastSyncLogTime'],
            resetPendingAt: ['reset', 'resetPendingAt'],
            resetPendingReason: ['reset', 'resetPendingReason'],
            resetPendingType: ['reset', 'resetPendingType'],
            resetPendingCallback: ['reset', 'resetPendingCallback'],
            catchUpTimeoutId: ['catchUp', 'catchUpTimeoutId'],
            catchUpAttempts: ['catchUp', 'catchUpAttempts'],
            lastCatchUpTime: ['catchUp', 'lastCatchUpTime']
        });

        const logHelper = PlaybackLogHelper.create({ video, videoId, state });

        const logDebugLazy = (messageOrFactory, detailFactory) => {
            if (!CONFIG.debug) return;
            if (typeof messageOrFactory === 'function') {
                const result = messageOrFactory();
                if (!result) return;
                logDebug(result.message, result.detail || {});
                return;
            }
            logDebug(messageOrFactory, detailFactory ? detailFactory() : {});
        };

        const getCurrentTime = () => (
            Number.isFinite(video.currentTime) ? Number(video.currentTime.toFixed(3)) : null
        );

        const evaluateResetState = (vs) => {
            const ranges = BufferGapFinder.getBufferRanges(video);
            const hasBuffer = ranges.length > 0;
            const hasSrc = Boolean(vs.currentSrc || vs.src);
            const lowReadyState = vs.readyState <= 1;
            const isHardReset = !hasSrc && lowReadyState;
            const isSoftReset = lowReadyState
                && !hasBuffer
                && (vs.networkState === 0 || vs.networkState === 3);

            return {
                ranges,
                hasBuffer,
                hasSrc,
                lowReadyState,
                isHardReset,
                isSoftReset
            };
        };

        const clearResetPending = (reason, vs) => {
            if (!state.resetPendingAt) return false;
            const now = Date.now();
            logDebugLazy(() => {
                const snapshot = vs || VideoState.get(video, videoId);
                return {
                    message: LogEvents.tagged('RESET_CLEAR', 'Reset pending cleared'),
                    detail: {
                        reason,
                        pendingForMs: now - state.resetPendingAt,
                        graceMs: CONFIG.stall.RESET_GRACE_MS,
                        resetType: state.resetPendingType,
                        hasSrc: Boolean(snapshot.currentSrc || snapshot.src),
                        readyState: snapshot.readyState,
                        networkState: snapshot.networkState,
                        buffered: snapshot.buffered || BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    }
                };
            });
            state.resetPendingAt = 0;
            state.resetPendingReason = null;
            state.resetPendingType = null;
            state.resetPendingCallback = null;
            return true;
        };

        const updateProgress = (reason) => {
            const now = Date.now();
            const timeDelta = video.currentTime - state.lastTime;
            const progressGapMs = state.lastProgressTime
                ? now - state.lastProgressTime
                : null;

            state.lastTime = video.currentTime;

            if (video.paused || timeDelta <= PROGRESS_EPSILON) {
                return;
            }

            if (state.stallStartTime) {
                const stallDurationMs = now - state.stallStartTime;
                state.stallStartTime = 0;
                Metrics.recordStallDuration(stallDurationMs, {
                    videoId,
                    reason,
                    bufferAhead: state.lastBufferAhead
                });
                logDebugLazy(() => logHelper.buildStallDuration(reason, stallDurationMs, state.lastBufferAhead));
            }

            if (!state.progressStartTime
                || (progressGapMs !== null && progressGapMs > CONFIG.monitoring.PROGRESS_STREAK_RESET_MS)) {
                if (state.progressStartTime) {
                    logDebugLazy(LogEvents.tagged('PROGRESS', 'Progress streak reset'), () => ({
                        reason,
                        progressGapMs,
                        previousStreakMs: state.progressStreakMs,
                        currentTime: getCurrentTime()
                    }));
                }
                state.progressStartTime = now;
                state.progressStreakMs = 0;
                state.progressEligible = false;
            } else {
                state.progressStreakMs = now - state.progressStartTime;
            }

            state.lastProgressTime = now;
            state.pauseFromStall = false;
            if (state.resetPendingAt) {
                clearResetPending('progress');
            }

            if (!state.progressEligible
                && state.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS) {
                state.progressEligible = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Candidate eligibility reached'), () => ({
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                    currentTime: getCurrentTime()
                }));
            }

            if (!state.hasProgress) {
                state.hasProgress = true;
                logDebugLazy(LogEvents.tagged('PROGRESS', 'Initial progress observed'), () => ({
                    reason,
                    currentTime: getCurrentTime()
                }));
            }

            if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
                logDebugLazy(LogEvents.tagged('BACKOFF', 'Cleared after progress'), () => ({
                    reason,
                    previousNoHealPoints: state.noHealPointCount,
                    previousNextHealAllowedMs: state.nextHealAllowedTime
                        ? (state.nextHealAllowedTime - now)
                        : 0
                }));
                state.noHealPointCount = 0;
                state.nextHealAllowedTime = 0;
            }

            if (state.playErrorCount > 0 || state.nextPlayHealAllowedTime > 0 || state.healPointRepeatCount > 0) {
                logDebugLazy(LogEvents.tagged('PLAY_BACKOFF', 'Cleared after progress'), () => ({
                    reason,
                    previousPlayErrors: state.playErrorCount,
                    previousNextPlayAllowedMs: state.nextPlayHealAllowedTime
                        ? (state.nextPlayHealAllowedTime - now)
                        : 0,
                    previousHealPointRepeats: state.healPointRepeatCount
                }));
                state.playErrorCount = 0;
                state.nextPlayHealAllowedTime = 0;
                state.lastPlayErrorTime = 0;
                state.lastPlayBackoffLogTime = 0;
                state.lastHealPointKey = null;
                state.healPointRepeatCount = 0;
            }

            if (state.bufferStarved || state.bufferStarvedSince) {
                logDebugLazy(LogEvents.tagged('STARVE_CLEAR', 'Buffer starvation cleared by progress'), () => ({
                    reason,
                    bufferStarvedSinceMs: state.bufferStarvedSince
                        ? (now - state.bufferStarvedSince)
                        : null
                }));
                state.bufferStarved = false;
                state.bufferStarvedSince = 0;
                state.bufferStarveUntil = 0;
                state.lastBufferStarveLogTime = 0;
                state.lastBufferStarveSkipLogTime = 0;
            }
        };

        const markReady = (reason) => {
            if (state.firstReadyTime) return;
            const src = video.currentSrc || video.getAttribute('src') || '';
            if (!src && video.readyState < 1) {
                return;
            }
            state.firstReadyTime = Date.now();
            logDebugLazy(LogEvents.tagged('READY', 'Initial ready state observed'), () => ({
                reason,
                readyState: video.readyState,
                currentSrc: VideoState.compactSrc(src)
            }));
            if (state.resetPendingAt) {
                const vs = VideoState.get(video, videoId);
                const resetState = evaluateResetState(vs);
                if (!resetState.isHardReset && !resetState.isSoftReset) {
                    clearResetPending('ready', vs);
                }
            }
        };

        const markStallEvent = (reason) => {
            state.lastStallEventTime = Date.now();
            if (!state.stallStartTime) {
                state.stallStartTime = state.lastStallEventTime;
            }
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
                logDebugLazy(LogEvents.tagged('STALL', 'Marked paused due to stall'), () => ({
                    reason,
                    currentTime: getCurrentTime()
                }));
            }
        };

        const handleReset = (reason, onReset) => {
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            logDebugLazy(LogEvents.tagged('RESET_CHECK', 'Reset evaluation'), () => ({
                reason,
                hasSrc: resetState.hasSrc,
                readyState: vs.readyState,
                networkState: vs.networkState,
                bufferRanges: BufferGapFinder.formatRanges(resetState.ranges),
                lastSrc: state.lastSrc,
                hardReset: resetState.isHardReset,
                softReset: resetState.isSoftReset
            }));

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                logDebugLazy(LogEvents.tagged('RESET_SKIP', 'Reset suppressed'), () => ({
                    reason,
                    hasSrc: resetState.hasSrc,
                    readyState: vs.readyState,
                    networkState: vs.networkState,
                    hasBuffer: resetState.hasBuffer
                }));
                return;
            }

            if (!state.resetPendingAt) {
                state.resetPendingAt = Date.now();
                state.resetPendingReason = reason;
                state.resetPendingType = resetState.isHardReset ? 'hard' : 'soft';
                logDebugLazy(LogEvents.tagged('RESET_PENDING', 'Reset pending'), () => ({
                    reason,
                    resetType: state.resetPendingType,
                    graceMs: CONFIG.stall.RESET_GRACE_MS,
                    hasSrc: resetState.hasSrc,
                    hasBuffer: resetState.hasBuffer,
                    readyState: vs.readyState,
                    networkState: vs.networkState
                }));
            }
            state.resetPendingCallback = onReset;
        };

        const evaluateResetPending = (trigger) => {
            if (!state.resetPendingAt) {
                return false;
            }
            const now = Date.now();
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                clearResetPending(trigger || 'recovered', vs);
                return false;
            }

            const pendingForMs = now - state.resetPendingAt;
            if (pendingForMs < CONFIG.stall.RESET_GRACE_MS) {
                return true;
            }

            const pendingReason = state.resetPendingReason || trigger;
            const pendingType = state.resetPendingType || (resetState.isHardReset ? 'hard' : 'soft');

            state.state = 'RESET';
            logDebugLazy(LogEvents.tagged('RESET', 'Video reset'), () => ({
                reason: pendingReason,
                resetType: pendingType,
                pendingForMs,
                graceMs: CONFIG.stall.RESET_GRACE_MS,
                hasSrc: resetState.hasSrc,
                hasBuffer: resetState.hasBuffer,
                readyState: vs.readyState,
                networkState: vs.networkState
            }));

            const callback = state.resetPendingCallback;
            state.resetPendingAt = 0;
            state.resetPendingReason = null;
            state.resetPendingType = null;
            state.resetPendingCallback = null;

            if (typeof callback === 'function') {
                callback({
                    reason: pendingReason,
                    resetType: pendingType,
                    pendingForMs,
                    videoState: vs
                }, state);
            }

            return true;
        };

        const shouldSkipUntilProgress = () => {
            if (!state.hasProgress) {
                const now = Date.now();
                markReady('watchdog_ready_check');
                const graceMs = CONFIG.stall.INIT_PROGRESS_GRACE_MS || CONFIG.stall.STALL_CONFIRM_MS;
                const baselineTime = state.firstReadyTime || state.firstSeenTime;
                const waitingForProgress = (now - baselineTime) < graceMs;

                if (waitingForProgress) {
                    if (!state.initLogEmitted) {
                        state.initLogEmitted = true;
                        logDebugLazy(LogEvents.tagged('WATCHDOG', 'Awaiting initial progress'), () => ({
                            state: state.state,
                            graceMs,
                            baseline: state.firstReadyTime ? 'ready' : 'seen'
                        }));
                    }
                    return true;
                }

                if (!state.initialProgressTimeoutLogged) {
                    state.initialProgressTimeoutLogged = true;
                    logDebugLazy(LogEvents.tagged('WATCHDOG', 'Initial progress timeout'), () => ({
                        state: state.state,
                        waitedMs: now - baselineTime,
                        graceMs,
                        baseline: state.firstReadyTime ? 'ready' : 'seen'
                    }));
                }

                return false;
            }
            return false;
        };

        const logSyncStatus = () => {
            const now = Date.now();
            if (video.paused || video.readyState < 2) {
                return;
            }
            if (!state.lastSyncWallTime) {
                state.lastSyncWallTime = now;
                state.lastSyncMediaTime = video.currentTime;
                return;
            }
            const wallDelta = now - state.lastSyncWallTime;
            if (wallDelta < CONFIG.monitoring.SYNC_SAMPLE_MS) {
                return;
            }
            const mediaDelta = (video.currentTime - state.lastSyncMediaTime) * 1000;
            state.lastSyncWallTime = now;
            state.lastSyncMediaTime = video.currentTime;

            if (wallDelta <= 0) {
                return;
            }

            const rate = mediaDelta / wallDelta;
            const driftMs = wallDelta - mediaDelta;
            const ranges = BufferGapFinder.getBufferRanges(video);
            const bufferEndDelta = ranges.length
                ? (ranges[ranges.length - 1].end - video.currentTime)
                : null;

            const shouldLog = (now - state.lastSyncLogTime >= CONFIG.logging.SYNC_LOG_MS)
                || driftMs >= CONFIG.monitoring.SYNC_DRIFT_MAX_MS
                || rate <= CONFIG.monitoring.SYNC_RATE_MIN;

            if (!shouldLog) {
                return;
            }
            state.lastSyncLogTime = now;
            logDebugLazy(LogEvents.tagged('SYNC', 'Playback drift sample'), () => ({
                wallDeltaMs: wallDelta,
                mediaDeltaMs: Math.round(mediaDelta),
                driftMs: Math.round(driftMs),
                rate: Number.isFinite(rate) ? rate.toFixed(3) : null,
                bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null
            }));
        };

        const updateBufferStarvation = (bufferInfo, reason, nowOverride) => {
            const now = Number.isFinite(nowOverride) ? nowOverride : Date.now();
            if (!bufferInfo) return false;

            let bufferAhead = bufferInfo.bufferAhead;
            if (!Number.isFinite(bufferAhead)) {
                if (bufferInfo.hasBuffer) {
                    bufferAhead = 0;
                } else {
                    state.lastBufferAhead = null;
                    return false;
                }
            }

            const prevBufferAhead = state.lastBufferAhead;
            state.lastBufferAhead = bufferAhead;
            state.lastBufferAheadUpdateTime = now;
            if (Number.isFinite(bufferAhead)) {
                if (Number.isFinite(prevBufferAhead)) {
                    if (bufferAhead > prevBufferAhead + 0.05) {
                        state.lastBufferAheadIncreaseTime = now;
                    }
                } else if (bufferAhead > 0) {
                    state.lastBufferAheadIncreaseTime = now;
                }
            }

            if (bufferAhead <= CONFIG.stall.BUFFER_STARVE_THRESHOLD_S) {
                if (!state.bufferStarvedSince) {
                    state.bufferStarvedSince = now;
                }

                const starvedForMs = now - state.bufferStarvedSince;
                if (!state.bufferStarved && starvedForMs >= CONFIG.stall.BUFFER_STARVE_CONFIRM_MS) {
                    state.bufferStarved = true;
                    state.bufferStarveUntil = now + CONFIG.stall.BUFFER_STARVE_BACKOFF_MS;
                    state.lastBufferStarveLogTime = now;
                    logDebugLazy(LogEvents.tagged('STARVE', 'Buffer starvation detected'), () => ({
                        reason,
                        bufferAhead: bufferAhead.toFixed(3),
                        threshold: CONFIG.stall.BUFFER_STARVE_THRESHOLD_S,
                        confirmMs: CONFIG.stall.BUFFER_STARVE_CONFIRM_MS,
                        backoffMs: CONFIG.stall.BUFFER_STARVE_BACKOFF_MS
                    }));
                } else if (state.bufferStarved
                    && (now - state.lastBufferStarveLogTime) >= CONFIG.logging.STARVE_LOG_MS) {
                    state.lastBufferStarveLogTime = now;
                    if (now >= state.bufferStarveUntil) {
                        state.bufferStarveUntil = now + CONFIG.stall.BUFFER_STARVE_BACKOFF_MS;
                    }
                    logDebugLazy(LogEvents.tagged('STARVE', 'Buffer starvation persists'), () => ({
                        reason,
                        bufferAhead: bufferAhead.toFixed(3),
                        starvedForMs,
                        nextHealAllowedInMs: Math.max(state.bufferStarveUntil - now, 0)
                    }));
                }
                return state.bufferStarved;
            }

            if (state.bufferStarved || state.bufferStarvedSince) {
                const starvedForMs = state.bufferStarvedSince ? (now - state.bufferStarvedSince) : null;
                state.bufferStarved = false;
                state.bufferStarvedSince = 0;
                state.bufferStarveUntil = 0;
                state.lastBufferStarveLogTime = 0;
                state.lastBufferStarveSkipLogTime = 0;
                logDebugLazy(LogEvents.tagged('STARVE_CLEAR', 'Buffer starvation cleared'), () => ({
                    reason,
                    starvedForMs,
                    bufferAhead: bufferAhead.toFixed(3)
                }));
            }

            return false;
        };

        return {
            state,
            updateProgress,
            markStallEvent,
            markReady,
            handleReset,
            shouldSkipUntilProgress,
            evaluateResetPending,
            clearResetPending,
            logSyncStatus,
            updateBufferStarvation
        };
    };

    return { create };
})();

