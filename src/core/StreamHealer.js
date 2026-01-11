// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    let isHealing = false;
    let healAttempts = 0;
    let monitoredCount = 0; // Track count manually (WeakMap has no .size)

    // Track monitored videos to prevent duplicate monitors
    const monitoredVideos = new WeakMap(); // video -> monitor
    const monitorsById = new Map(); // videoId -> { video, monitor }
    const videoIds = new WeakMap();
    let nextVideoId = 1;
    let candidateIntervalId = null;
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;

    const LOG = {
        POLL_START: '[HEALER:POLL_START]',
        POLL_SUCCESS: '[HEALER:POLL_SUCCESS]',
        POLL_TIMEOUT: '[HEALER:POLL_TIMEOUT]',
        POLLING: '[HEALER:POLLING]',
        SELF_RECOVERED: '[HEALER:SELF_RECOVERED]',
        START: '[HEALER:START]',
        DEBOUNCE: '[HEALER:DEBOUNCE]',
        STALL_DETECTED: '[STALL:DETECTED]'
    };

    const logDebug = (message, detail) => {
        if (CONFIG.debug) {
            Logger.add(message, detail);
        }
    };

    const getVideoId = (video) => {
        let id = videoIds.get(video);
        if (!id) {
            id = `video-${nextVideoId++}`;
            videoIds.set(video, id);
        }
        return id;
    };

    const logWithState = (message, video, detail = {}) => {
        Logger.add(message, {
            ...detail,
            videoState: VideoState.get(video, getVideoId(video))
        });
    };

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);
    const candidateSelector = CandidateSelector.create({
        monitorsById,
        getVideoId,
        logDebug,
        maxMonitors: CONFIG.monitoring.MAX_VIDEO_MONITORS,
        minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
        switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
        isFallbackSource
    });
    const recoveryManager = RecoveryManager.create({
        monitorsById,
        candidateSelector,
        getVideoId,
        logDebug
    });
    candidateSelector.setLockChecker(recoveryManager.isFailoverActive);

    const startCandidateEvaluation = () => {
        if (candidateIntervalId) return;
        candidateIntervalId = setInterval(() => {
            candidateSelector.evaluateCandidates('interval');
        }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
    };

    const stopCandidateEvaluationIfIdle = () => {
        if (monitorsById.size === 0 && candidateIntervalId) {
            clearInterval(candidateIntervalId);
            candidateIntervalId = null;
            candidateSelector.setActiveId(null);
        }
    };

    const getActiveEntry = () => {
        const activeId = candidateSelector.getActiveId();
        if (activeId && monitorsById.has(activeId)) {
            return { id: activeId, entry: monitorsById.get(activeId) };
        }
        const first = monitorsById.entries().next();
        if (!first.done) {
            return { id: first.value[0], entry: first.value[1] };
        }
        return null;
    };

    const logCandidateSnapshot = (reason) => {
        const candidates = [];
        for (const [videoId, entry] of monitorsById.entries()) {
            const score = candidateSelector.scoreVideo(entry.video, entry.monitor, videoId);
            candidates.push({
                videoId,
                score: score.score,
                progressEligible: score.progressEligible,
                progressStreakMs: score.progressStreakMs,
                progressAgoMs: score.progressAgoMs,
                readyState: score.vs.readyState,
                paused: score.vs.paused,
                currentSrc: score.vs.currentSrc,
                reasons: score.reasons
            });
        }
        Logger.add('[HEALER:CANDIDATE_SNAPSHOT] Candidates scored', {
            reason,
            candidates
        });
    };

    /**
     * Check if video has recovered (recent progress observed)
     */
    const hasRecovered = (video, state) => {
        if (!video || !state) return false;
        return Date.now() - state.lastProgressTime < CONFIG.stall.RECOVERY_WINDOW_MS;
    };

    /**
     * Poll for a heal point with timeout
     * Includes early abort if video self-recovers
     */
    const pollForHealPoint = async (video, state, timeoutMs) => {
        const startTime = Date.now();
        let pollCount = 0;

        logWithState(LOG.POLL_START, video, {
            timeout: timeoutMs + 'ms'
        });

        while (Date.now() - startTime < timeoutMs) {
            pollCount++;

            // Early abort: Check if video recovered on its own
            if (hasRecovered(video, state)) {
                logWithState(LOG.SELF_RECOVERED, video, {
                    pollCount,
                    elapsed: (Date.now() - startTime) + 'ms'
                });
                return null; // No need to heal - already playing
            }

            // Use silent mode during polling to reduce log spam
            const healPoint = BufferGapFinder.findHealPoint(video, { silent: true });

            if (healPoint) {
                Logger.add(LOG.POLL_SUCCESS, {
                    attempts: pollCount,
                    type: healPoint.isNudge ? 'NUDGE' : 'GAP',
                    elapsed: (Date.now() - startTime) + 'ms',
                    healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    bufferSize: (healPoint.end - healPoint.start).toFixed(2) + 's'
                });
                return healPoint;
            }

            // Log progress every 25 polls (~5 seconds)
            if (pollCount % 25 === 0) {
                logDebug(LOG.POLLING, {
                    attempt: pollCount,
                    elapsed: (Date.now() - startTime) + 'ms',
                    buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                });
            }

            await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
        }

        Logger.add(LOG.POLL_TIMEOUT, {
            attempts: pollCount,
            elapsed: (Date.now() - startTime) + 'ms',
            finalState: VideoState.get(video, getVideoId(video))
        });

        return null;
    };

    /**
     * Main heal attempt
     */
    const attemptHeal = async (video, state) => {
        if (isHealing) {
            Logger.add('[HEALER:BLOCKED] Already healing');
            return;
        }

        isHealing = true;
        healAttempts++;
        const healStartTime = performance.now();
        if (state) {
            state.state = 'HEALING';
            state.lastHealAttemptTime = Date.now();
        }

        logWithState(LOG.START, video, {
            attempt: healAttempts,
            lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined
        });

        try {
            // Step 1: Poll for heal point
            const healPoint = await pollForHealPoint(video, state, CONFIG.stall.HEAL_TIMEOUT_S * 1000);

            // Check if we got null due to self-recovery (not timeout)
            if (!healPoint) {
                if (hasRecovered(video, state)) {
                    Logger.add('[HEALER:SKIPPED] Video recovered, no heal needed', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                        finalState: VideoState.get(video, getVideoId(video))
                    });
                    recoveryManager.resetBackoff(state, 'self_recovered');
                    // Don't count as failed - video is fine
                    return;
                }

                Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                    duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                    suggestion: 'User may need to refresh page',
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, state, 'no_heal_point');
                return;
            }

            // Step 2: Re-validate heal point is still fresh before seeking
            const freshPoint = BufferGapFinder.findHealPoint(video, { silent: true });
            if (!freshPoint) {
                // No heal point anymore - check if video recovered
                if (hasRecovered(video, state)) {
                    Logger.add('[HEALER:STALE_RECOVERED] Heal point gone, but video recovered', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms'
                    });
                    recoveryManager.resetBackoff(state, 'stale_recovered');
                    return;
                }
                Logger.add('[HEALER:STALE_GONE] Heal point disappeared before seek', {
                    original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
                recoveryManager.handleNoHealPoint(video, state, 'stale_gone');
                return;
            }

            // Use fresh point if it's different (buffer may have grown)
            const targetPoint = freshPoint;
            if (freshPoint.start !== healPoint.start || freshPoint.end !== healPoint.end) {
                Logger.add('[HEALER:POINT_UPDATED] Using refreshed heal point', {
                    original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                    type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
                });
            }

            // Step 3: Seek to heal point and play
            const result = await LiveEdgeSeeker.seekAndPlay(video, targetPoint);

            const duration = (performance.now() - healStartTime).toFixed(0);

            if (result.success) {
                Logger.add('[HEALER:COMPLETE] Stream healed successfully', {
                    duration: duration + 'ms',
                    healAttempts,
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_successful');
                recoveryManager.resetBackoff(state, 'heal_success');
            } else {
                Logger.add('[HEALER:FAILED] Heal attempt failed', {
                    duration: duration + 'ms',
                    error: result.error,
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
            }
        } catch (e) {
            Logger.add('[HEALER:ERROR] Unexpected error during heal', {
                error: e.name,
                message: e.message,
                stack: e.stack?.split('\n')[0]
            });
            Metrics.increment('heals_failed');
        } finally {
            isHealing = false;
            if (state) {
                if (video.paused) {
                    state.state = 'PAUSED';
                } else if (hasRecovered(video, state)) {
                    state.state = 'PLAYING';
                } else {
                    state.state = 'STALLED';
                }
            }
        }
    };

    /**
     * Handle stall detection event
     */
    const onStallDetected = (video, details = {}, state = null) => {
        const now = Date.now();
        const videoId = getVideoId(video);

        if (recoveryManager.shouldSkipStall(videoId, state)) {
            return;
        }

        if (state) {
            const progressedSinceAttempt = state.lastProgressTime > state.lastHealAttemptTime;
            if (progressedSinceAttempt && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
                logDebug(LOG.DEBOUNCE, {
                    cooldownMs: CONFIG.stall.RETRY_COOLDOWN_MS,
                    lastHealAttemptAgoMs: now - state.lastHealAttemptTime,
                    state: state.state,
                    videoId
                });
                return;
            }
        }
        if (state) {
            state.lastHealAttemptTime = now;
        }

        candidateSelector.evaluateCandidates('stall');
        const activeCandidateId = candidateSelector.getActiveId();
        if (activeCandidateId && activeCandidateId !== videoId) {
            logDebug('[HEALER:STALL_SKIP] Stall on non-active video', {
                videoId,
                activeVideoId: activeCandidateId,
                stalledFor: details.stalledFor
            });
            return;
        }

        logWithState(LOG.STALL_DETECTED, video, {
            ...details,
            lastProgressAgoMs: state ? (Date.now() - state.lastProgressTime) : undefined,
            videoId
        });

        Metrics.increment('stalls_detected');
        attemptHeal(video, state);
    };

    const handleExternalSignal = (signal = {}) => {
        if (!signal || monitorsById.size === 0) return;

        const type = signal.type || 'unknown';
        const level = signal.level || 'unknown';
        const message = signal.message || '';

        if (type === 'playhead_stall') {
            const active = getActiveEntry();
            if (!active) return;
            const now = Date.now();
            const state = active.entry.monitor.state;
            state.lastStallEventTime = now;
            state.pauseFromStall = true;

            Logger.add('[HEALER:STALL_HINT] Console playhead stall warning', {
                videoId: active.id,
                level,
                message: message.substring(0, 300),
                lastProgressAgoMs: state.lastProgressTime ? (now - state.lastProgressTime) : null,
                videoState: VideoState.get(active.entry.video, active.id)
            });

            if (!state.hasProgress || !state.lastProgressTime) {
                return;
            }

            const stalledForMs = now - state.lastProgressTime;
            if (stalledForMs >= CONFIG.stall.STALL_CONFIRM_MS) {
                onStallDetected(active.entry.video, {
                    trigger: 'CONSOLE_STALL',
                    stalledFor: stalledForMs + 'ms',
                    bufferExhausted: BufferGapFinder.isBufferExhausted(active.entry.video),
                    paused: active.entry.video.paused,
                    pauseFromStall: true
                }, state);
            }
            return;
        }

        if (type === 'processing_asset') {
            Logger.add('[HEALER:ASSET_HINT] Processing/offline asset detected', {
                level,
                message: message.substring(0, 300)
            });

            logCandidateSnapshot('processing_asset');

            if (recoveryManager.isFailoverActive()) {
                logDebug('[HEALER:ASSET_HINT_SKIP] Failover in progress', {
                    reason: 'processing_asset'
                });
                return;
            }

            const best = candidateSelector.evaluateCandidates('processing_asset');
            let activeId = candidateSelector.getActiveId();

            if (best && best.id && activeId && best.id !== activeId && best.progressEligible) {
                const fromId = activeId;
                activeId = best.id;
                candidateSelector.setActiveId(activeId);
                Logger.add('[HEALER:CANDIDATE] Forced switch after processing asset', {
                    from: fromId,
                    to: activeId,
                    bestScore: best.score,
                    progressStreakMs: best.progressStreakMs,
                    progressEligible: best.progressEligible
                });
            }

            const activeEntry = activeId ? monitorsById.get(activeId) : null;
            if (activeEntry) {
                const playPromise = activeEntry.video?.play?.();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((err) => {
                        Logger.add('[HEALER:ASSET_HINT_PLAY] Play rejected', {
                            videoId: activeId,
                            error: err?.name,
                            message: err?.message
                        });
                    });
                }
            }
            return;
        }

        Logger.add('[HEALER:EXTERNAL] Unhandled external signal', {
            type,
            level,
            message: message.substring(0, 300)
        });
    };

    /**
     * Stop monitoring a specific video
     */
    const stopMonitoring = (video) => {
        const monitor = monitoredVideos.get(video);
        if (!monitor) return;

        monitor.stop();
        monitoredVideos.delete(video);
        const videoId = getVideoId(video);
        monitorsById.delete(videoId);
        monitoredCount--;
        recoveryManager.onMonitorRemoved(videoId);
        if (candidateSelector.getActiveId() === videoId) {
            candidateSelector.setActiveId(null);
            if (monitorsById.size > 0) {
                candidateSelector.evaluateCandidates('removed');
            }
        }
        stopCandidateEvaluationIfIdle();
        Logger.add('[HEALER:STOP] Stopped monitoring video', {
            remainingMonitors: monitoredCount,
            videoId
        });
    };

    /**
     * Start monitoring a video element
     */
    const monitor = (video) => {
        if (!video) return;

        // Prevent duplicate monitoring of the same video
        if (monitoredVideos.has(video)) {
            logDebug('[HEALER:SKIP] Video already being monitored');
            return;
        }

        const videoId = getVideoId(video);
        Logger.add('[HEALER:VIDEO] Video registered', {
            videoId,
            videoState: VideoState.get(video, videoId)
        });

        const monitor = PlaybackMonitor.create(video, {
            isHealing: () => isHealing,
            onRemoved: () => stopMonitoring(video),
            onStall: (details, state) => onStallDetected(video, details, state),
            onReset: (details) => {
                Logger.add('[HEALER:RESET] Video reset detected', {
                    videoId,
                    ...details
                });
                candidateSelector.evaluateCandidates('reset');
            },
            videoId
        });

        monitor.start();

        // Track this video monitor
        monitoredVideos.set(video, monitor);
        monitorsById.set(videoId, { video, monitor });
        monitoredCount++;
        startCandidateEvaluation();
        candidateSelector.pruneMonitors(videoId, stopMonitoring);
        candidateSelector.evaluateCandidates('register');

        Logger.add('[HEALER:MONITOR] Started monitoring video', {
            videoId,
            debug: CONFIG.debug,
            checkInterval: CONFIG.stall.WATCHDOG_INTERVAL_MS + 'ms',
            totalMonitors: monitoredCount
        });
    };

    return {
        monitor,
        stopMonitoring,
        onStallDetected,
        attemptHeal,
        handleExternalSignal,
        getStats: () => ({ healAttempts, isHealing, monitoredCount })
    };
})();








