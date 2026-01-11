// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    let isHealing = false;
    let healAttempts = 0;
    let monitoredCount = 0; // Track count manually (WeakMap has no .size)
    let activeVideo = null; // Track the current active video

    // Track monitored videos to prevent duplicate timers
    const monitoredVideos = new WeakMap(); // video -> { intervalId, handlers, state }

    /**
     * Get current video state for logging
     */
    const getVideoState = (video) => {
        if (!video) return { error: 'NO_VIDEO' };
        return {
            currentTime: video.currentTime?.toFixed(3),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
        };
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

        Logger.add('[HEALER:POLL_START] Polling for heal point', {
            timeout: timeoutMs + 'ms',
            videoState: getVideoState(video)
        });

        while (Date.now() - startTime < timeoutMs) {
            pollCount++;

            // Early abort: Check if video recovered on its own
            if (hasRecovered(video, state)) {
                Logger.add('[HEALER:SELF_RECOVERED] Video recovered during polling', {
                    pollCount,
                    elapsed: (Date.now() - startTime) + 'ms',
                    videoState: getVideoState(video)
                });
                return null; // No need to heal - already playing
            }

            // Use silent mode during polling to reduce log spam
            const healPoint = BufferGapFinder.findHealPoint(video, { silent: true });

            if (healPoint) {
                Logger.add('[HEALER:POLL_SUCCESS] Heal point found', {
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
                Logger.add('[HEALER:POLLING]', {
                    attempt: pollCount,
                    elapsed: (Date.now() - startTime) + 'ms',
                    buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                });
            }

            await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
        }

        Logger.add('[HEALER:POLL_TIMEOUT] No heal point found within timeout', {
            attempts: pollCount,
            elapsed: (Date.now() - startTime) + 'ms',
            finalState: getVideoState(video)
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

        Logger.add('[HEALER:START] Beginning heal attempt', {
            attempt: healAttempts,
            videoState: getVideoState(video)
        });

        try {
            // Step 1: Poll for heal point
            const healPoint = await pollForHealPoint(video, state, CONFIG.stall.HEAL_TIMEOUT_S * 1000);

            // Check if we got null due to self-recovery (not timeout)
            if (!healPoint) {
                if (hasRecovered(video, state)) {
                    Logger.add('[HEALER:SKIPPED] Video recovered, no heal needed', {
                        duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                        finalState: getVideoState(video)
                    });
                    // Don't count as failed - video is fine
                    return;
                }

                Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                    duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                    suggestion: 'User may need to refresh page',
                    finalState: getVideoState(video)
                });
                Metrics.increment('heals_failed');
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
                    return;
                }
                Logger.add('[HEALER:STALE_GONE] Heal point disappeared before seek', {
                    original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                    finalState: getVideoState(video)
                });
                Metrics.increment('heals_failed');
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
                    finalState: getVideoState(video)
                });
                Metrics.increment('heals_successful');
            } else {
                Logger.add('[HEALER:FAILED] Heal attempt failed', {
                    duration: duration + 'ms',
                    error: result.error,
                    finalState: getVideoState(video)
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

        if (state && now - state.lastHealAttemptTime < CONFIG.stall.RETRY_COOLDOWN_MS) {
            Logger.add('[HEALER:DEBOUNCE] Ignoring rapid stall event');
            return;
        }
        if (state) {
            state.lastHealAttemptTime = now;
        }

        Logger.add('[STALL:DETECTED] Stall detected, initiating heal', {
            ...details,
            videoState: getVideoState(video)
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

        if (monitor.intervalId !== undefined) {
            clearInterval(monitor.intervalId);
        }

        if (monitor.handlers) {
            Object.entries(monitor.handlers).forEach(([event, handler]) => {
                video.removeEventListener(event, handler);
            });
        }

        monitoredVideos.delete(video);
        monitoredCount--;
        if (video === activeVideo) {
            activeVideo = null;
        }
        Logger.add('[HEALER:STOP] Stopped monitoring video', {
            remainingMonitors: monitoredCount
        });
    };

    /**
     * Start monitoring a video element
     */
    const monitor = (video) => {
        if (!video) return;

        // Prevent duplicate monitoring of the same video
        if (monitoredVideos.has(video)) {
            Logger.add('[HEALER:SKIP] Video already being monitored');
            return;
        }

        if (activeVideo && activeVideo !== video) {
            stopMonitoring(activeVideo);
        }
        activeVideo = video;

        const state = {
            lastProgressTime: Date.now(),
            lastTime: video.currentTime,
            state: 'PLAYING',
            lastHealAttemptTime: 0
        };

        const handlers = {
            timeupdate: () => {
                state.lastProgressTime = Date.now();
                state.lastTime = video.currentTime;
                if (state.state !== 'HEALING') {
                    state.state = 'PLAYING';
                }
            },
            playing: () => {
                state.lastProgressTime = Date.now();
                if (state.state !== 'HEALING') {
                    state.state = 'PLAYING';
                }
            },
            waiting: () => {
                if (!video.paused && state.state !== 'HEALING') {
                    state.state = 'STALLED';
                }
            },
            stalled: () => {
                if (!video.paused && state.state !== 'HEALING') {
                    state.state = 'STALLED';
                }
            },
            pause: () => {
                state.state = 'PAUSED';
            }
        };

        Object.entries(handlers).forEach(([event, handler]) => {
            video.addEventListener(event, handler);
        });

        const checkInterval = setInterval(() => {
            // Cleanup if video removed from DOM
            if (!document.contains(video)) {
                Logger.add('[HEALER:CLEANUP] Video removed from DOM');
                stopMonitoring(video);
                return;
            }

            // Pause monitoring while healing is active to prevent race conditions
            if (isHealing) {
                return;
            }

            if (video.paused) {
                state.state = 'PAUSED';
                return;
            }

            const stalledForMs = Date.now() - state.lastProgressTime;
            if (stalledForMs < CONFIG.stall.STALL_CONFIRM_MS) {
                return;
            }

            const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
            onStallDetected(video, {
                trigger: 'WATCHDOG',
                stalledFor: stalledForMs + 'ms',
                bufferExhausted,
                videoState: getVideoState(video)
            }, state);
        }, CONFIG.stall.WATCHDOG_INTERVAL_MS);

        // Track this video's interval
        monitoredVideos.set(video, { intervalId: checkInterval, handlers, state });
        monitoredCount++;

        Logger.add('[HEALER:MONITOR] Started monitoring video', {
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




