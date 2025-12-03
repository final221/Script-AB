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
            if (isFixing) {
                if (Date.now() - recoveryStartTime > RECOVERY_TIMEOUT_MS) {
                    Logger.add('[Resilience] Force-resetting stuck recovery lock');
                    isFixing = false;
                } else {
                    Logger.add('[Resilience] Recovery already in progress, skipping');
                    return false;
                }
            }

            const video = Adapters.DOM.find('video');
            if (!video) {
                Logger.add('[Resilience] No video element found');
                return false;
            }

            // 2. Check if already healthy (prevent unnecessary recovery)
            // Skip check if forced
            if (!payload.forceAggressive && !payload.forceExperimental && RecoveryValidator.detectAlreadyHealthy(video)) {
                Logger.add('[Resilience] Video appears healthy, skipping recovery', {
                    reason,
                    readyState: video.readyState,
                    paused: video.paused
                });
                return true;
            }

            // 3. A/V Sync Routing
            if (AVSyncRouter.shouldRouteToAVSync(reason)) {
                return await AVSyncRouter.executeAVSyncRecovery();
            }

            isFixing = true;
            recoveryStartTime = Date.now();

            try {
                // 4. Pre-recovery Snapshot
                const preSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);

                Logger.add(`[Resilience] Starting recovery: ${reason}`, {
                    preSnapshot
                });

                // 5. Strategy Selection & Execution
                // Note: BufferAnalyzer and RecoveryStrategy are assumed to be global modules
                const bufferHealth = BufferAnalyzer.analyze(video);

                // Legacy support: update payload if buffer is critical
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

                // 7. Escalation Handling
                if (!validation.isValid && !validation.hasImprovement) {
                    Logger.add('[Resilience] Recovery ineffective, considering escalation...');
                    // Logic for escalation could go here or be delegated
                }

                // 8. Play Retry
                // Ensure playback resumes if it was playing or if recovery implies playing
                if (!video.paused || validation.hasImprovement) {
                    await PlayRetryHandler.retry(video, 'post-recovery');
                }

                return validation.isValid;

            } catch (error) {
                Logger.add('[Resilience] Critical error during recovery', {
                    message: error.message,
                    stack: error.stack
                });
                return false;
            } finally {
                isFixing = false;
            }
        }
    };
})();
