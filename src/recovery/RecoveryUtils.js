// --- Recovery Utilities ---
/**
 * Shared utilities for recovery modules.
 * @responsibility Provide common state capture and logging helpers.
 */
const RecoveryUtils = (() => {
    /**
     * Captures current video state snapshot.
     * @param {HTMLVideoElement} video - The video element
     * @returns {Object} State snapshot
     */
    const captureVideoState = (video) => ({
        readyState: video.readyState,
        networkState: video.networkState,
        currentTime: video.currentTime,
        paused: video.paused,
        error: video.error ? video.error.code : null,
        bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
    });

    /**
     * Logs state transitions between two snapshots.
     * @param {Object} lastState - Previous state snapshot
     * @param {Object} currentState - Current state snapshot
     * @param {number} elapsed - Elapsed time in ms
     */
    const logStateTransitions = (lastState, currentState, elapsed) => {
        if (!lastState) return;

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
    };

    /**
     * Waits for video to reach ready state with forensic logging.
     * @param {HTMLVideoElement} video - The video element
     * @param {Object} options - Configuration options
     * @param {number} options.startTime - Recovery start timestamp
     * @param {number} options.timeoutMs - Max wait time
     * @param {number} options.checkIntervalMs - Check interval
     * @returns {Promise<void>}
     */
    const waitForStability = (video, options) => {
        const { startTime, timeoutMs, checkIntervalMs } = options;

        return new Promise(resolve => {
            const maxChecks = timeoutMs / checkIntervalMs;
            let checkCount = 0;
            let lastState = null;
            let lastCurrentTime = video.currentTime;

            const interval = setInterval(() => {
                const elapsed = performance.now() - startTime;
                const currentState = captureVideoState(video);

                // Log state transitions
                logStateTransitions(lastState, currentState, elapsed);

                // Log progress every 1 second (10 checks at 100ms intervals)
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
                        duration_ms: elapsed.toFixed(0),
                        finalReadyState: video.readyState,
                        totalChecks: checkCount
                    });
                    resolve();
                } else if (checkCount >= maxChecks) {
                    clearInterval(interval);
                    Logger.add('Player stabilization timeout', {
                        duration_ms: elapsed.toFixed(0),
                        finalReadyState: video.readyState,
                        finalNetworkState: video.networkState,
                        totalChecks: checkCount,
                        lastError: video.error ? video.error.code : null
                    });
                    resolve();
                }
            }, checkIntervalMs);
        });
    };

    return {
        captureVideoState,
        logStateTransitions,
        waitForStability
    };
})();
