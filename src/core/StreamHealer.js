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
    let activeCandidateId = null;
    let candidateIntervalId = null;
    const MAX_VIDEO_MONITORS = CONFIG.monitoring.MAX_VIDEO_MONITORS;
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;
    const failoverState = {
        inProgress: false,
        timerId: null,
        lastAttemptTime: 0,
        fromId: null,
        toId: null,
        startTime: 0,
        baselineProgressTime: 0
    };

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

    const getVideoIndex = (videoId) => {
        const match = /video-(\d+)/.exec(videoId);
        return match ? Number(match[1]) : -1;
    };

    const logWithState = (message, video, detail = {}) => {
        Logger.add(message, {
            ...detail,
            videoState: VideoState.get(video, getVideoId(video))
        });
    };

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);

    const scoreVideo = (video, monitor, videoId) => {
        const vs = VideoState.get(video, videoId);
        const state = monitor.state;
        const progressAgoMs = state.hasProgress && state.lastProgressTime
            ? Date.now() - state.lastProgressTime
            : null;
        const progressStreakMs = state.progressStreakMs || 0;
        const progressEligible = state.progressEligible
            || progressStreakMs >= CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS;
        let score = 0;
        const reasons = [];

        if (!document.contains(video)) {
            score -= 10;
            reasons.push('not_in_dom');
        }

        if (vs.ended) {
            score -= 5;
            reasons.push('ended');
        }

        if (vs.errorCode) {
            score -= 3;
            reasons.push('error');
        }

        if (state.state === 'RESET') {
            score -= 3;
            reasons.push('reset');
        }

        if (state.state === 'ERROR') {
            score -= 2;
            reasons.push('error_state');
        }

        if (isFallbackSource(vs.currentSrc)) {
            score -= 4;
            reasons.push('fallback_src');
        }

        if (!vs.paused) {
            score += 2;
            reasons.push('playing');
        } else {
            score -= 1;
            reasons.push('paused');
        }

        if (vs.readyState >= 3) {
            score += 2;
            reasons.push('ready_high');
        } else if (vs.readyState >= 2) {
            score += 1;
            reasons.push('ready_mid');
        } else {
            score -= 1;
            reasons.push('ready_low');
        }

        if (progressAgoMs === null) {
            score -= 2;
            reasons.push('no_progress');
        } else if (progressAgoMs < 2000) {
            score += 3;
            reasons.push('recent_progress');
        } else if (progressAgoMs < 5000) {
            score += 1;
            reasons.push('stale_progress');
        } else {
            score -= 1;
            reasons.push('no_progress');
        }

        if (!progressEligible) {
            score -= 3;
            reasons.push('progress_short');
        }

        if (vs.buffered !== 'none') {
            score += 1;
            reasons.push('buffered');
        }

        const timeValue = Number.parseFloat(vs.currentTime);
        if (!Number.isNaN(timeValue) && timeValue > 0) {
            score += 1;
            reasons.push('time_nonzero');
        }

        return {
            score,
            reasons,
            vs,
            progressAgoMs,
            progressStreakMs,
            progressEligible
        };
    };

    const evaluateCandidates = (reason) => {
        if (failoverState.inProgress) {
            logDebug('[HEALER:CANDIDATE] Failover lock active', {
                reason,
                activeVideoId: activeCandidateId,
                failoverTo: failoverState.toId
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
                } else if (!currentBad && delta < CONFIG.monitoring.CANDIDATE_SWITCH_DELTA) {
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
                    minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
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

    const resetFailover = (reason) => {
        if (failoverState.timerId) {
            clearTimeout(failoverState.timerId);
        }
        if (failoverState.inProgress) {
            Logger.add('[HEALER:FAILOVER] Cleared', {
                reason,
                from: failoverState.fromId,
                to: failoverState.toId
            });
        }
        failoverState.inProgress = false;
        failoverState.timerId = null;
        failoverState.fromId = null;
        failoverState.toId = null;
        failoverState.startTime = 0;
        failoverState.baselineProgressTime = 0;
    };

    const resetNoHealPointState = (state, reason) => {
        if (!state) return;
        if (state.noHealPointCount > 0 || state.nextHealAllowedTime > 0) {
            logDebug('[HEALER:BACKOFF] Reset', {
                reason,
                previousNoHealPoints: state.noHealPointCount,
                previousNextHealAllowedMs: state.nextHealAllowedTime
                    ? Math.max(state.nextHealAllowedTime - Date.now(), 0)
                    : 0
            });
        }
        state.noHealPointCount = 0;
        state.nextHealAllowedTime = 0;
    };

    const applyNoHealPointBackoff = (videoId, state, reason) => {
        if (!state) return;
        const count = (state.noHealPointCount || 0) + 1;
        const base = CONFIG.stall.NO_HEAL_POINT_BACKOFF_BASE_MS;
        const max = CONFIG.stall.NO_HEAL_POINT_BACKOFF_MAX_MS;
        const backoffMs = Math.min(base * count, max);

        state.noHealPointCount = count;
        state.nextHealAllowedTime = Date.now() + backoffMs;

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

    const attemptFailover = (fromVideoId, reason, state) => {
        const now = Date.now();
        if (failoverState.inProgress) {
            logDebug('[HEALER:FAILOVER_SKIP] Failover already in progress', {
                from: fromVideoId,
                reason
            });
            return false;
        }
        if (now - failoverState.lastAttemptTime < CONFIG.stall.FAILOVER_COOLDOWN_MS) {
            logDebug('[HEALER:FAILOVER_SKIP] Failover cooldown active', {
                from: fromVideoId,
                reason,
                cooldownMs: CONFIG.stall.FAILOVER_COOLDOWN_MS,
                lastAttemptAgoMs: now - failoverState.lastAttemptTime
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

        failoverState.inProgress = true;
        failoverState.lastAttemptTime = now;
        failoverState.fromId = fromVideoId;
        failoverState.toId = toId;
        failoverState.startTime = now;
        failoverState.baselineProgressTime = entry.monitor.state.lastProgressTime || 0;

        activeCandidateId = toId;

        Logger.add('[HEALER:FAILOVER] Switching to candidate', {
            from: fromVideoId,
            to: toId,
            reason,
            stalledForMs: state?.lastProgressTime ? (now - state.lastProgressTime) : null,
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

        failoverState.timerId = setTimeout(() => {
            if (!failoverState.inProgress || failoverState.toId !== toId) {
                return;
            }

            const currentEntry = monitorsById.get(toId);
            const fromEntry = monitorsById.get(fromVideoId);
            const latestProgressTime = currentEntry?.monitor.state.lastProgressTime || 0;
            const progressed = currentEntry
                && currentEntry.monitor.state.hasProgress
                && latestProgressTime > failoverState.baselineProgressTime
                && latestProgressTime >= failoverState.startTime;

            if (progressed) {
                Logger.add('[HEALER:FAILOVER_SUCCESS] Candidate progressed', {
                    from: fromVideoId,
                    to: toId,
                    progressDelayMs: latestProgressTime - failoverState.startTime,
                    candidateState: VideoState.get(currentEntry.video, toId)
                });
                resetNoHealPointState(currentEntry.monitor.state, 'failover_success');
            } else {
                Logger.add('[HEALER:FAILOVER_REVERT] Candidate did not progress', {
                    from: fromVideoId,
                    to: toId,
                    timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS,
                    progressObserved: Boolean(currentEntry?.monitor.state.hasProgress),
                    candidateState: currentEntry ? VideoState.get(currentEntry.video, toId) : null
                });
                if (fromEntry) {
                    activeCandidateId = fromVideoId;
                }
            }

            resetFailover('timeout');
        }, CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS);

        return true;
    };

    const handleNoHealPoint = (video, state, reason) => {
        const videoId = getVideoId(video);
        applyNoHealPointBackoff(videoId, state, reason);

        const stalledForMs = state?.lastProgressTime ? (Date.now() - state.lastProgressTime) : null;
        const shouldFailover = monitorsById.size > 1
            && (state?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

        if (shouldFailover) {
            attemptFailover(videoId, reason, state);
        }
    };

    const startCandidateEvaluation = () => {
        if (candidateIntervalId) return;
        candidateIntervalId = setInterval(() => {
            evaluateCandidates('interval');
        }, CONFIG.stall.WATCHDOG_INTERVAL_MS);
    };

    const stopCandidateEvaluationIfIdle = () => {
        if (monitorsById.size === 0 && candidateIntervalId) {
            clearInterval(candidateIntervalId);
            candidateIntervalId = null;
            activeCandidateId = null;
        }
    };

    const pruneMonitors = (excludeId) => {
        if (monitorsById.size <= MAX_VIDEO_MONITORS) return;

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
                maxMonitors: MAX_VIDEO_MONITORS
            });
            stopMonitoring(worst.entry.video);
        }
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
                    resetNoHealPointState(state, 'self_recovered');
                    // Don't count as failed - video is fine
                    return;
                }

                Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                    duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                    suggestion: 'User may need to refresh page',
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
                handleNoHealPoint(video, state, 'no_heal_point');
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
                    resetNoHealPointState(state, 'stale_recovered');
                    return;
                }
                Logger.add('[HEALER:STALE_GONE] Heal point disappeared before seek', {
                    original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    finalState: VideoState.get(video, getVideoId(video))
                });
                Metrics.increment('heals_failed');
                handleNoHealPoint(video, state, 'stale_gone');
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
                resetNoHealPointState(state, 'heal_success');
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

        if (failoverState.inProgress && failoverState.toId === videoId) {
            const elapsedMs = now - failoverState.startTime;
            if (elapsedMs < CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS) {
                logDebug('[HEALER:FAILOVER] Stall ignored during failover', {
                    videoId,
                    elapsedMs,
                    timeoutMs: CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS
                });
                return;
            }
        }

        if (state?.nextHealAllowedTime && now < state.nextHealAllowedTime) {
            if (now - (state.lastBackoffLogTime || 0) > 5000) {
                state.lastBackoffLogTime = now;
                logDebug('[HEALER:BACKOFF] Stall skipped due to backoff', {
                    videoId,
                    remainingMs: state.nextHealAllowedTime - now,
                    noHealPointCount: state.noHealPointCount
                });
            }
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

        evaluateCandidates('stall');
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
        if (failoverState.inProgress && (videoId === failoverState.toId || videoId === failoverState.fromId)) {
            resetFailover('monitor_removed');
        }
        if (activeCandidateId === videoId) {
            activeCandidateId = null;
            if (monitorsById.size > 0) {
                evaluateCandidates('removed');
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
                evaluateCandidates('reset');
            },
            videoId
        });

        monitor.start();

        // Track this video monitor
        monitoredVideos.set(video, monitor);
        monitorsById.set(videoId, { video, monitor });
        monitoredCount++;
        startCandidateEvaluation();
        pruneMonitors(videoId);
        evaluateCandidates('register');

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
        getStats: () => ({ healAttempts, isHealing, monitoredCount })
    };
})();








