// --- Aggressive Recovery ---
/**
 * Stream refresh recovery strategy via src clearing.
 * @responsibility Force stream refresh when stuck at buffer end.
 */
const AggressiveRecovery = (() => {
    const READY_CHECK_INTERVAL_MS = 100;

    return {
        execute: async (video) => {
            Metrics.increment('aggressive_recoveries');
            Logger.add('Executing aggressive recovery: waiting for player to stabilize');
            const recoveryStartTime = performance.now();
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            // Enhanced Telemetry
            const bufferEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
            Logger.add('Aggressive recovery telemetry', {
                strategy: 'PASSIVE_WAIT',
                url: originalSrc,
                isBlobUrl: isBlobUrl,
                telemetry: {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    currentTime: video.currentTime,
                    bufferEnd: bufferEnd,
                    paused: video.paused,
                    error: video.error ? video.error.code : null
                }
            });

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;

            // CRITICAL: DO NOT seek, DO NOT reload, DO NOT touch the src!
            // Analysis of logs showed that ANY manipulation (seeking to infinity, bufferEnd+5s, etc.)
            // causes massive A/V desync (100+ seconds) or AbortErrors.
            // The player is smart enough to recover on its own. Our job is to just wait.
            // This is the approach from the early version that worked reliably.

            // Wait for stream to be ready (with forensic logging)
            await new Promise(resolve => {
                const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / READY_CHECK_INTERVAL_MS;
                let checkCount = 0;
                let lastState = null;
                let lastCurrentTime = video.currentTime;

                const interval = setInterval(() => {
                    const elapsed = performance.now() - recoveryStartTime;
                    const currentState = {
                        readyState: video.readyState,
                        networkState: video.networkState,
                        currentTime: video.currentTime,
                        paused: video.paused,
                        error: video.error ? video.error.code : null,
                        bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
                    };

                    // Detect and log state transitions
                    if (lastState) {
                        if (lastState.readyState !== currentState.readyState) {
                            Logger.add('Recovery: readyState transition', {
                                from: lastState.readyState,
                                to: currentState.readyState,
                                elapsed_ms: elapsed.toFixed(0)
                            });
                        }
                        if (lastState.networkState !== currentState.networkState) {
                            Logger.add('Recovery: networkState transition', {
                                from: lastState.networkState,
                                to: currentState.networkState,
                                elapsed_ms: elapsed.toFixed(0)
                            });
                        }
                        if (!lastState.error && currentState.error) {
                            Logger.add('Recovery: ERROR appeared during wait', {
                                errorCode: currentState.error,
                                elapsed_ms: elapsed.toFixed(0)
                            });
                        }
                    }

                    // Log progress every 1 second (10 checks)
                    if (checkCount % 10 === 0 && checkCount > 0) {
                        const timeAdvanced = Math.abs(currentState.currentTime - lastCurrentTime) > 0.1;
                        Logger.add(`Recovery progress [${elapsed.toFixed(0)}ms]`, {
                            ...currentState,
                            playheadMoving: timeAdvanced
                        });
                    }

                    lastState = { ...currentState };
                    lastCurrentTime = currentState.currentTime;
                    checkCount++;

                    // Success condition
                    if (video.readyState >= 2) {
                        clearInterval(interval);
                        Logger.add('Player stabilized successfully', {
                            duration_ms: performance.now() - recoveryStartTime,
                            finalReadyState: video.readyState,
                            totalChecks: checkCount
                        });
                        resolve();
                    } else if (checkCount >= maxChecks) {
                        clearInterval(interval);
                        Logger.add('Player stabilization timeout', {
                            duration_ms: performance.now() - recoveryStartTime,
                            finalReadyState: video.readyState,
                            finalNetworkState: video.networkState,
                            totalChecks: checkCount,
                            lastError: video.error ? video.error.code : null
                        });
                        resolve();
                    }
                }, READY_CHECK_INTERVAL_MS);
            });

            // Restore video state
            try {
                video.playbackRate = playbackRate;
                video.volume = volume;
                video.muted = muted;
            } catch (e) {
                Logger.add('Failed to restore video state', { error: e.message });
            }
        }
    };
})();
