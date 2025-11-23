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

                // Check buffer and select strategy
                const analysis = BufferAnalyzer.analyze(video);

                // Skip buffer check if forced
                if (!payload.forceAggressive && analysis.bufferHealth === 'critical') {
                    Logger.add('[RECOVERY] Insufficient buffer for recovery, waiting');
                    return;
                }

                // Capture pre-recovery snapshot
                const preSnapshot = {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    currentTime: video.currentTime,
                    paused: video.paused,
                    error: video.error ? video.error.code : null,
                    bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
                };
                Logger.add('[RECOVERY] Pre-recovery snapshot', preSnapshot);

                // Execute recovery strategy
                const strategy = RecoveryStrategy.select(video, payload.forceAggressive);
                await strategy.execute(video);

                // Capture post-recovery snapshot
                const postSnapshot = {
                    readyState: video.readyState,
                    networkState: video.networkState,
                    currentTime: video.currentTime,
                    paused: video.paused,
                    error: video.error ? video.error.code : null,
                    bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
                };

                // Calculate and log delta
                const delta = {
                    readyStateChanged: preSnapshot.readyState !== postSnapshot.readyState,
                    networkStateChanged: preSnapshot.networkState !== postSnapshot.networkState,
                    errorAppeared: !preSnapshot.error && postSnapshot.error,
                    errorCleared: preSnapshot.error && !postSnapshot.error,
                    pausedStateChanged: preSnapshot.paused !== postSnapshot.paused
                };
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
