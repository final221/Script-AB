// --- Resilience Orchestrator ---
/**
 * Orchestrates recovery execution.
 * @responsibility
 * 1. Guard against concurrent recovery attempts.
 * 2. Coordinate buffer analysis, strategy selection, and execution.
 * 3. Handle play retry after recovery.
 */
const ResilienceOrchestrator = (() => {
    return {
        /**
         * Main entry point for recovery.
         * @param {HTMLElement} container - The player container (unused, but kept for API compatibility)
         * @param {Object} payload - Event payload containing reason and flags
         * @returns {Promise<boolean>} True if recovery was successful
         */
        execute: async (container, payload = {}) => {
            const reason = payload.reason || 'unknown';

            // 1. Concurrency Guard
            if (!RecoveryLock.acquire()) {
                Logger.add('[Resilience] Recovery already in progress, skipping');
                return false;
            }

            try {
                const video = Adapters.DOM.find('video');
                if (!video) {
                    Logger.add('[Resilience] No video element found');
                    return false;
                }

                // 2. Check if already healthy (prevent unnecessary recovery)
                if (!payload.forceAggressive && !payload.forceExperimental && RecoveryValidator.detectAlreadyHealthy(video)) {
                    Logger.add('[Resilience] Video appears healthy, skipping recovery', { reason });
                    return true;
                }

                // 3. A/V Sync Routing
                if (AVSyncRouter.shouldRouteToAVSync(reason)) {
                    return await AVSyncRouter.executeAVSyncRecovery();
                }

                // 4. Pre-recovery Snapshot
                const preSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);
                Logger.add(`[Resilience] Starting recovery: ${reason}`, { preSnapshot });

                // 5. Strategy Selection & Execution
                const bufferHealth = BufferAnalyzer.analyze(video);
                if (bufferHealth && bufferHealth.bufferHealth === 'critical') {
                    payload.forceAggressive = true;
                }

                const strategy = RecoveryStrategy.select(video, payload);
                Logger.add(`[Resilience] Selected strategy: ${strategy.name}`);
                await strategy.execute(video);

                // 6. Post-recovery Snapshot & Validation
                const postSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);
                const delta = VideoSnapshotHelper.calculateRecoveryDelta(preSnapshot, postSnapshot);
                const validation = RecoveryValidator.validateRecoverySuccess(preSnapshot, postSnapshot, delta);

                Logger.add('[Resilience] Recovery result', {
                    valid: validation.isValid,
                    issues: validation.issues,
                    delta
                });

                // 6.5. Escalation (if recovery failed)
                if (!validation.isValid) {
                    Logger.add('[Resilience] Recovery ineffective, attempting escalation...');

                    // Escalation: Jump to buffer end (live edge)
                    if (video.buffered.length > 0) {
                        try {
                            const end = video.buffered.end(video.buffered.length - 1);
                            // Jump to 2s from end to be safe, or 0.5s if buffer is small
                            const target = Math.max(video.currentTime, end - 2);
                            video.currentTime = target;
                            Logger.add('[Resilience] Escalation: Jumped to buffer end', { target: target.toFixed(3) });

                            // Re-validate? No, just let PlayRetry handle it
                        } catch (e) {
                            Logger.add('[Resilience] Escalation failed', { error: e.message });
                        }
                    }
                }

                // 7. Play Retry - ALWAYS attempt if video is paused or had improvement
                const shouldRetryPlay = video.paused || validation.hasImprovement;

                Logger.add('[Resilience] Play retry decision', {
                    videoPaused: video.paused,
                    hasImprovement: validation.hasImprovement,
                    willRetry: shouldRetryPlay,
                    readyState: video.readyState
                });

                if (shouldRetryPlay) {
                    Logger.add('[Resilience] Initiating PlayRetryHandler');
                    const playSuccess = await PlayRetryHandler.retry(video, 'post-recovery');

                    Logger.add('[Resilience] PlayRetryHandler result', {
                        success: playSuccess,
                        finalPaused: video.paused,
                        finalReadyState: video.readyState
                    });

                    // 8. Nuclear Fallback - If everything failed and video still broken
                    if (!playSuccess && !validation.isValid && video.paused && video.readyState <= 1) {
                        Logger.add('[Resilience] All recovery strategies exhausted, triggering page reload', {
                            readyState: video.readyState,
                            paused: video.paused
                        });

                        // Attempt page reload as last resort
                        try {
                            // Notify via event bus first (if UI available)
                            if (typeof Adapters.EventBus !== 'undefined') {
                                Adapters.EventBus.emit('recovery:fatal', {
                                    reason: 'All recovery strategies failed',
                                    action: 'page_reload'
                                });
                            }

                            // Delay slightly to allow any logging/state save
                            await Fn.sleep(500);
                            window.location.reload();
                        } catch (e) {
                            Logger.add('[Resilience] Page reload failed', { error: e.message });
                        }
                    }
                } else {
                    Logger.add('[Resilience] Skipping PlayRetry - video already playing', {
                        paused: video.paused,
                        currentTime: video.currentTime.toFixed(3)
                    });
                }

                return validation.isValid;

            } catch (error) {
                Logger.add('[Resilience] Critical error during recovery', {
                    message: error.message,
                    stack: error.stack
                });
                return false;
            } finally {
                RecoveryLock.release();
            }
        }
    };
})();
