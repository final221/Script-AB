// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    let isHealing = false;
    let healAttempts = 0;
    let lastStallTime = 0;

    // Track monitored videos to prevent duplicate timers
    const monitoredVideos = new WeakMap(); // video -> intervalId

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
     * Check if video is currently stalled (not making progress with exhausted buffer)
     */
    const isStalled = (video, moved) => {
        if (!video) return false;

        // Must not be paused and must not have moved
        if (video.paused || moved) return false;

        // Check if we have enough data
        if (video.readyState >= 4) return false; // HAVE_ENOUGH_DATA

        // Check if buffer is exhausted at current position
        return BufferGapFinder.isBufferExhausted(video);
    };

    /**
     * Poll for a heal point with timeout
     */
    const pollForHealPoint = async (video, timeoutMs) => {
        const startTime = Date.now();
        let pollCount = 0;

        Logger.add('[HEALER:POLL_START] Polling for heal point', {
            timeout: timeoutMs + 'ms',
            videoState: getVideoState(video)
        });

        while (Date.now() - startTime < timeoutMs) {
            pollCount++;

            // Use silent mode during polling to reduce log spam
            const healPoint = BufferGapFinder.findHealPoint(video, { silent: true });

            if (healPoint) {
                Logger.add('[HEALER:POLL_SUCCESS] Heal point found', {
                    attempts: pollCount,
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
    const attemptHeal = async (video) => {
        if (isHealing) {
            Logger.add('[HEALER:BLOCKED] Already healing');
            return;
        }

        isHealing = true;
        healAttempts++;
        const healStartTime = performance.now();

        Logger.add('[HEALER:START] Beginning heal attempt', {
            attempt: healAttempts,
            videoState: getVideoState(video)
        });

        try {
            // Step 1: Poll for heal point
            const healPoint = await pollForHealPoint(video, CONFIG.stall.HEAL_TIMEOUT_S * 1000);

            if (!healPoint) {
                Logger.add('[HEALER:NO_HEAL_POINT] Could not find heal point', {
                    duration: (performance.now() - healStartTime).toFixed(0) + 'ms',
                    suggestion: 'User may need to refresh page',
                    finalState: getVideoState(video)
                });
                Metrics.increment('heals_failed');
                return;
            }

            // Step 2: Seek to heal point and play
            const result = await LiveEdgeSeeker.seekAndPlay(video, healPoint);

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
        }
    };

    /**
     * Handle stall detection event
     */
    const onStallDetected = (video, details = {}) => {
        const now = Date.now();

        // Debounce rapid stall events (5 seconds)
        if (now - lastStallTime < 5000) {
            Logger.add('[HEALER:DEBOUNCE] Ignoring rapid stall event');
            return;
        }
        lastStallTime = now;

        Logger.add('[STALL:DETECTED] Stall detected, initiating heal', {
            ...details,
            videoState: getVideoState(video)
        });

        Metrics.increment('stalls_detected');
        attemptHeal(video);
    };

    /**
     * Stop monitoring a specific video
     */
    const stopMonitoring = (video) => {
        const intervalId = monitoredVideos.get(video);
        if (intervalId) {
            clearInterval(intervalId);
            monitoredVideos.delete(video);
            Logger.add('[HEALER:STOP] Stopped monitoring video');
        }
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

        let lastTime = video.currentTime;
        let stuckCount = 0;

        const checkInterval = setInterval(() => {
            // Cleanup if video removed from DOM
            if (!document.contains(video)) {
                Logger.add('[HEALER:CLEANUP] Video removed from DOM');
                stopMonitoring(video);
                return;
            }

            const currentTime = video.currentTime;
            const moved = Math.abs(currentTime - lastTime) > 0.1;

            // Use consolidated isStalled check
            if (isStalled(video, moved)) {
                stuckCount++;

                if (stuckCount >= CONFIG.stall.STUCK_COUNT_TRIGGER) {
                    onStallDetected(video, {
                        stuckCount,
                        trigger: 'STUCK_MONITOR'
                    });
                    stuckCount = 0; // Reset after triggering
                }
            } else {
                stuckCount = 0;
            }

            lastTime = currentTime;
        }, CONFIG.stall.DETECTION_INTERVAL_MS);

        // Track this video's interval
        monitoredVideos.set(video, checkInterval);

        Logger.add('[HEALER:MONITOR] Started monitoring video', {
            checkInterval: CONFIG.stall.DETECTION_INTERVAL_MS + 'ms',
            stuckTrigger: CONFIG.stall.STUCK_COUNT_TRIGGER
        });
    };

    return {
        monitor,
        stopMonitoring,
        onStallDetected,
        attemptHeal,
        getStats: () => ({ healAttempts, isHealing, monitoredCount: monitoredVideos.size || 0 })
    };
})();
