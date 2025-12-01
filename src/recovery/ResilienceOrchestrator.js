// --- Resilience Orchestrator ---
/**
 * Orchestrates recovery execution.
 * @responsibility
 * 1. Guard against concurrent recovery attempts.
 * 2. Coordinate buffer analysis, strategy selection, and execution.
 * 3. Handle play retry after recovery.
 */
const ResilienceOrchestrator = (() => {
    let isFixing = false;
    let recoveryStartTime = 0;
    const RECOVERY_TIMEOUT_MS = 10000;

    /**
     * Captures a snapshot of current video element state.
     * @param {HTMLVideoElement} video - The video element to snapshot
     * @returns {Object} Snapshot containing readyState, networkState, currentTime, etc.
     */
    const captureVideoSnapshot = (video) => {
        return {
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
            paused: video.paused,
            error: video.error ? video.error.code : null,
            bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
        };
    };

    /**
     * Calculates the delta between pre and post recovery snapshots.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @returns {Object} Delta object showing what changed
     */
    const calculateRecoveryDelta = (preSnapshot, postSnapshot) => {
        return {
            readyStateChanged: preSnapshot.readyState !== postSnapshot.readyState,
            networkStateChanged: preSnapshot.networkState !== postSnapshot.networkState,
            errorAppeared: !preSnapshot.error && postSnapshot.error,
            errorCleared: preSnapshot.error && !postSnapshot.error,
            pausedStateChanged: preSnapshot.paused !== postSnapshot.paused
        };
    };

    return {
        execute: async (container, payload = {}) => {
            if (isFixing) {
                // Check for stale lock
                if (Date.now() - recoveryStartTime > RECOVERY_TIMEOUT_MS) {
                    Logger.add('[RECOVERY] WARNING: Stale lock detected (timeout exceeded), forcing release');
                    isFixing = false;
                } else {
                    Logger.add('[RECOVERY] Resilience already in progress, skipping');
                    return;
                }
            }

            isFixing = true;
            recoveryStartTime = Date.now();
            let timeoutId = null;

            // Safety valve: Force unlock if execution takes too long
            timeoutId = setTimeout(() => {
                if (isFixing && Date.now() - recoveryStartTime >= RECOVERY_TIMEOUT_MS) {
                    Logger.add('[RECOVERY] WARNING: Execution timed out, forcing lock release');
                    isFixing = false;
                }
            }, RECOVERY_TIMEOUT_MS);

            const startTime = performance.now();

            try {
                Logger.add('[RECOVERY] Resilience execution started');
                Metrics.increment('resilience_executions');

                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) {
                    Logger.add('[RECOVERY] Resilience aborted: No video element found');
                    return;
                }

                // Check for fatal errors
                const { error } = video;
                if (error && error.code === CONFIG.codes.MEDIA_ERROR_SRC) {
                    Logger.add('[RECOVERY] Fatal error (code 4) - cannot recover, waiting for Twitch reload');
                    return;
                }

                // Check buffer health
                const analysis = BufferAnalyzer.analyze(video);
                // Removed blocking check for critical buffer to allow recovery to proceed
                // if (!payload.forceAggressive && analysis.bufferHealth === 'critical') {
                //    Logger.add('[RECOVERY] Insufficient buffer for recovery, waiting');
                //    return;
                // }

                // Capture pre-recovery state
                const preSnapshot = captureVideoSnapshot(video);
                Logger.add('[RECOVERY] Pre-recovery snapshot', preSnapshot);

                // Execute primary recovery strategy and handle escalation
                let currentStrategy = RecoveryStrategy.select(video, payload);

                while (currentStrategy) {
                    // Check if lock was stolen/timed out during execution
                    if (!isFixing) {
                        Logger.add('[RECOVERY] Lock lost during execution, aborting');
                        break;
                    }

                    await currentStrategy.execute(video);

                    // Check if we need to escalate to a more aggressive strategy
                    currentStrategy = RecoveryStrategy.getEscalation(video, currentStrategy);
                }

                // Capture post-recovery state and calculate delta
                const postSnapshot = captureVideoSnapshot(video);
                const delta = calculateRecoveryDelta(preSnapshot, postSnapshot);
                Logger.add('[RECOVERY] Post-recovery delta', { pre: preSnapshot, post: postSnapshot, changes: delta });

                // Resume playback if needed
                if (video.paused) {
                    await PlayRetryHandler.retry(video, 'post-recovery');
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
            } catch (e) {
                Logger.add('[RECOVERY] Resilience failed', { error: String(e) });
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
                isFixing = false;
                Logger.add('[RECOVERY] Resilience execution finished', {
                    total_duration_ms: performance.now() - startTime
                });
            }
        }
    };
})();

