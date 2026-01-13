// --- PlaybackStateTracker ---
/**
 * Shared playback state tracking for PlaybackMonitor.
 */
const PlaybackStateTracker = (() => {
    const PROGRESS_EPSILON = 0.05;

    const create = (video, videoId, logDebug) => {
        const state = {
            lastProgressTime: 0,
            lastTime: video.currentTime,
            progressStartTime: null,
            progressStreakMs: 0,
            progressEligible: false,
            hasProgress: false,
            firstSeenTime: Date.now(),
            firstReadyTime: 0,
            initialProgressTimeoutLogged: false,
            noHealPointCount: 0,
            nextHealAllowedTime: 0,
            playErrorCount: 0,
            nextPlayHealAllowedTime: 0,
            lastPlayErrorTime: 0,
            lastPlayBackoffLogTime: 0,
            lastHealPointKey: null,
            healPointRepeatCount: 0,
            lastBackoffLogTime: 0,
            initLogEmitted: false,
            state: 'PLAYING',
            lastHealAttemptTime: 0,
            lastWatchdogLogTime: 0,
            lastNonActiveEventLogTime: 0,
            nonActiveEventCounts: {},
            lastActiveEventLogTime: 0,
            lastActiveEventSummaryTime: 0,
            activeEventCounts: {},
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
            lastSrcAttr: video.getAttribute ? (video.getAttribute('src') || '') : '',
            lastReadyState: video.readyState,
            lastNetworkState: video.networkState,
            lastBufferedLength: (() => {
                try {
                    return video.buffered ? video.buffered.length : 0;
                } catch (error) {
                    return 0;
                }
            })(),
            lastStallEventTime: 0,
            pauseFromStall: false,
            lastSyncWallTime: 0,
            lastSyncMediaTime: 0,
            lastSyncLogTime: 0,
            catchUpTimeoutId: null,
            catchUpAttempts: 0,
            lastCatchUpTime: 0,
            resetPendingAt: 0,
            resetPendingReason: null,
            resetPendingType: null,
            resetPendingCallback: null
        };

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
            const snapshot = vs || VideoState.get(video, videoId);
            logDebug('[HEALER:RESET_CLEAR] Reset pending cleared', {
                reason,
                pendingForMs: now - state.resetPendingAt,
                graceMs: CONFIG.stall.RESET_GRACE_MS,
                resetType: state.resetPendingType,
                hasSrc: Boolean(snapshot.currentSrc || snapshot.src),
                readyState: snapshot.readyState,
                networkState: snapshot.networkState,
                buffered: snapshot.buffered || BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video)),
                videoState: snapshot
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

            if (!state.progressStartTime
                || (progressGapMs !== null && progressGapMs > CONFIG.monitoring.PROGRESS_STREAK_RESET_MS)) {
                if (state.progressStartTime) {
                    logDebug('[HEALER:PROGRESS] Progress streak reset', {
                        reason,
                        progressGapMs,
                        previousStreakMs: state.progressStreakMs,
                        videoState: VideoState.get(video, videoId)
                    });
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
                clearResetPending('progress', VideoState.get(video, videoId));
            }

            if (!state.progressEligible
                && state.progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS) {
                state.progressEligible = true;
                logDebug('[HEALER:PROGRESS] Candidate eligibility reached', {
                    reason,
                    progressStreakMs: state.progressStreakMs,
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                    videoState: VideoState.get(video, videoId)
                });
            }

            if (!state.hasProgress) {
                state.hasProgress = true;
                logDebug('[HEALER:PROGRESS] Initial progress observed', {
                    reason,
                    videoState: VideoState.get(video, videoId)
                });
            }

            if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
                logDebug('[HEALER:BACKOFF] Cleared after progress', {
                    reason,
                    previousNoHealPoints: state.noHealPointCount,
                    previousNextHealAllowedMs: state.nextHealAllowedTime
                        ? (state.nextHealAllowedTime - now)
                        : 0
                });
                state.noHealPointCount = 0;
                state.nextHealAllowedTime = 0;
            }

            if (state.playErrorCount > 0 || state.nextPlayHealAllowedTime > 0 || state.healPointRepeatCount > 0) {
                logDebug('[HEALER:PLAY_BACKOFF] Cleared after progress', {
                    reason,
                    previousPlayErrors: state.playErrorCount,
                    previousNextPlayAllowedMs: state.nextPlayHealAllowedTime
                        ? (state.nextPlayHealAllowedTime - now)
                        : 0,
                    previousHealPointRepeats: state.healPointRepeatCount
                });
                state.playErrorCount = 0;
                state.nextPlayHealAllowedTime = 0;
                state.lastPlayErrorTime = 0;
                state.lastPlayBackoffLogTime = 0;
                state.lastHealPointKey = null;
                state.healPointRepeatCount = 0;
            }
        };

        const markReady = (reason) => {
            if (state.firstReadyTime) return;
            const src = video.currentSrc || video.getAttribute('src') || '';
            if (!src && video.readyState < 1) {
                return;
            }
            state.firstReadyTime = Date.now();
            logDebug('[HEALER:READY] Initial ready state observed', {
                reason,
                readyState: video.readyState,
                currentSrc: src
            });
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
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
                logDebug('[HEALER:STALL] Marked paused due to stall', {
                    reason,
                    videoState: VideoState.get(video, videoId)
                });
            }
        };

        const handleReset = (reason, onReset) => {
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            logDebug('[HEALER:RESET_CHECK] Reset evaluation', {
                reason,
                hasSrc: resetState.hasSrc,
                readyState: vs.readyState,
                networkState: vs.networkState,
                bufferRanges: BufferGapFinder.formatRanges(resetState.ranges),
                lastSrc: state.lastSrc,
                hardReset: resetState.isHardReset,
                softReset: resetState.isSoftReset
            });

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                logDebug('[HEALER:RESET_SKIP] Reset suppressed', {
                    reason,
                    hasSrc: resetState.hasSrc,
                    readyState: vs.readyState,
                    networkState: vs.networkState,
                    hasBuffer: resetState.hasBuffer
                });
                return;
            }

            if (!state.resetPendingAt) {
                state.resetPendingAt = Date.now();
                state.resetPendingReason = reason;
                state.resetPendingType = resetState.isHardReset ? 'hard' : 'soft';
                logDebug('[HEALER:RESET_PENDING] Reset pending', {
                    reason,
                    resetType: state.resetPendingType,
                    graceMs: CONFIG.stall.RESET_GRACE_MS,
                    videoState: vs
                });
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
            logDebug('[HEALER:RESET] Video reset', {
                reason: pendingReason,
                resetType: pendingType,
                pendingForMs,
                graceMs: CONFIG.stall.RESET_GRACE_MS,
                videoState: vs
            });

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
                        logDebug('[HEALER:WATCHDOG] Awaiting initial progress', {
                            state: state.state,
                            graceMs,
                            baseline: state.firstReadyTime ? 'ready' : 'seen',
                            videoState: VideoState.get(video, videoId)
                        });
                    }
                    return true;
                }

                if (!state.initialProgressTimeoutLogged) {
                    state.initialProgressTimeoutLogged = true;
                    logDebug('[HEALER:WATCHDOG] Initial progress timeout', {
                        state: state.state,
                        waitedMs: now - baselineTime,
                        graceMs,
                        baseline: state.firstReadyTime ? 'ready' : 'seen',
                        videoState: VideoState.get(video, videoId)
                    });
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
            logDebug('[HEALER:SYNC] Playback drift sample', {
                wallDeltaMs: wallDelta,
                mediaDeltaMs: Math.round(mediaDelta),
                driftMs: Math.round(driftMs),
                rate: Number.isFinite(rate) ? rate.toFixed(3) : null,
                bufferEndDelta: bufferEndDelta !== null ? bufferEndDelta.toFixed(2) + 's' : null,
                videoState: VideoState.getLite(video, videoId)
            });
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
            logSyncStatus
        };
    };

    return { create };
})();
