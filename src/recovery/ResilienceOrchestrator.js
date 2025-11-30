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

    /**
     * Attempts cascading recovery: Standard → Experimental → Aggressive.
     * Only cascades if StandardRecovery was used and buffer still needs aggressive recovery.
     * @param {HTMLVideoElement} video - The video element
     * @param {Object} strategy - The initially selected recovery strategy
     */
    const attemptCascadingRecovery = async (video, strategy) => {
        if (strategy !== StandardRecovery) {
            return; // No cascade needed for non-standard strategies
        }

        const postStandardAnalysis = BufferAnalyzer.analyze(video);
        if (!postStandardAnalysis.needsAggressive) {
            return; // Standard recovery was sufficient
        }

        // Try experimental recovery if enabled
        if (ExperimentalRecovery.isEnabled() && ExperimentalRecovery.hasStrategies()) {
            Logger.add('[RECOVERY] Standard insufficient, trying experimental');
            await ExperimentalRecovery.execute(video);

            const postExperimentalAnalysis = BufferAnalyzer.analyze(video);
            if (postExperimentalAnalysis.needsAggressive) {
                Logger.add('[RECOVERY] Experimental insufficient, falling back to aggressive');
                await AggressiveRecovery.execute(video);
            } else {
                Logger.add('[RECOVERY] Experimental recovery successful');
            }
        } else {
            Logger.add('[RECOVERY] Standard insufficient, using aggressive');
            await AggressiveRecovery.execute(video);
        }
    };

    return {
        execute: async (container, payload = {}) => {
            if (isFixing) {
                Logger.add('[RECOVERY] Resilience already in progress, skipping');
                return;
            }
            isFixing = true;
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
                if (!payload.forceAggressive && analysis.bufferHealth === 'critical') {
                    Logger.add('[RECOVERY] Insufficient buffer for recovery, waiting');
                    return;
                }

                // Capture pre-recovery state
                const preSnapshot = captureVideoSnapshot(video);
                Logger.add('[RECOVERY] Pre-recovery snapshot', preSnapshot);

                // Execute primary recovery strategy
                const strategy = RecoveryStrategy.select(video, payload);
                await strategy.execute(video);

                // Attempt cascading recovery if needed
                await attemptCascadingRecovery(video, strategy);

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
                isFixing = false;
                Logger.add('[RECOVERY] Resilience execution finished', {
                    total_duration_ms: performance.now() - startTime
                });
            }
        }
    };
})();

