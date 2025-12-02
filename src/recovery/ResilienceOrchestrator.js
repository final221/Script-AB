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
            currentTimeChanged: preSnapshot.currentTime !== postSnapshot.currentTime,
            pausedStateChanged: preSnapshot.paused !== postSnapshot.paused,
            errorCleared: preSnapshot.error && !postSnapshot.error,
            errorAppeared: !preSnapshot.error && postSnapshot.error,
            bufferIncreased: postSnapshot.bufferEnd > preSnapshot.bufferEnd
        };
    };

    /**
     * Validates if recovery actually improved the state.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @param {Object} delta - Calculated changes
     * @returns {{isValid: boolean, issues: string[], hasImprovement: boolean}}
     */
    const validateRecoverySuccess = (preSnapshot, postSnapshot, delta) => {
        const issues = [];

        // Check 1: Ready state should not decrease
        if (delta.readyStateChanged && postSnapshot.readyState < preSnapshot.readyState) {
            issues.push(`readyState decreased: ${preSnapshot.readyState} → ${postSnapshot.readyState}`);
        }

        // Check 2: Error should not appear
        if (delta.errorAppeared) {
            issues.push(`MediaError appeared: code ${postSnapshot.error}`);
        }

        // Check 3: Should have some positive change
        const hasImprovement = (
            delta.errorCleared ||  // Error was fixed
            (delta.readyStateChanged && postSnapshot.readyState > preSnapshot.readyState) ||
            (postSnapshot.bufferEnd > preSnapshot.bufferEnd + 0.1) // Buffer increased
        );

        if (!hasImprovement && !delta.pausedStateChanged) {
            issues.push('No measurable improvement detected');
        }

        return {
            isValid: issues.length === 0,
            issues,
            hasImprovement
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

                // Fatal error check (existing)
                const { error } = video;
                if (error && error.code === CONFIG.codes.MEDIA_ERROR_SRC) {
                    Logger.add('[RECOVERY] Fatal error (code 4) - cannot recover, waiting for Twitch reload');
                    return;
                }

                // NEW: Use RecoveryDiagnostics
                const diagnosis = RecoveryDiagnostics.diagnose(video);
                if (!diagnosis.canRecover) {
                    Logger.add('[RECOVERY] Fatal blocker detected', diagnosis);
                    return;
                }

                // MODIFIED: Intelligent buffer validation
                const analysis = BufferAnalyzer.analyze(video);
                if (!payload.forceAggressive && analysis.bufferHealth === 'critical') {
                    // Critical buffer means standard recovery (seeking) will fail
                    const bufferSize = analysis.bufferSize || 0;

                    if (bufferSize < 2) {
                        Logger.add('[RECOVERY] Critical buffer - forcing aggressive recovery', {
                            bufferSize: bufferSize.toFixed(3),
                            bufferHealth: 'critical',
                            rationale: 'Standard recovery requires buffer > 2s, forcing stream refresh'
                        });
                        payload.forceAggressive = true; // Escalate to aggressive
                    } else {
                        Logger.add('[RECOVERY] Insufficient buffer but acceptable for recovery', {
                            bufferSize: bufferSize.toFixed(3)
                        });
                    }
                }

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

                // NEW: Validate recovery
                const postSnapshot = captureVideoSnapshot(video);
                const delta = calculateRecoveryDelta(preSnapshot, postSnapshot);
                const recoverySuccess = validateRecoverySuccess(preSnapshot, postSnapshot, delta);

                Logger.add('[RECOVERY] Post-recovery result', {
                    pre: preSnapshot,
                    post: postSnapshot,
                    changes: delta,
                    success: recoverySuccess
                });

                // NEW: Conditional escalation and play retry
                if (!recoverySuccess.isValid) {
                    Logger.add('[RECOVERY] Recovery validation detected issues', recoverySuccess.issues);

                    // NEW: Check if pre-state was already healthy
                    const wasAlreadyHealthy = preSnapshot.readyState === 4 &&
                        !preSnapshot.paused &&
                        !preSnapshot.error &&
                        analysis.bufferHealth !== 'critical';

                    if (wasAlreadyHealthy) {
                        Logger.add('[RECOVERY] Video was already healthy - recovery was unnecessary, canceling escalation');
                        // Do not escalate
                    } else if (!payload.forceAggressive) {
                        Logger.add('[RECOVERY] Escalating to aggressive recovery due to validation failure');
                        payload.forceAggressive = true;

                        // Re-run recovery with aggressive strategy
                        const aggressiveStrategy = RecoveryStrategy.select(video, payload);
                        if (aggressiveStrategy) {
                            await aggressiveStrategy.execute(video);

                            // Re-validate after aggressive recovery
                            const postSnapshot2 = captureVideoSnapshot(video);
                            const delta2 = calculateRecoveryDelta(postSnapshot, postSnapshot2);
                            const recoverySuccess2 = validateRecoverySuccess(postSnapshot, postSnapshot2, delta2);

                            Logger.add('[RECOVERY] Aggressive recovery result', {
                                success: recoverySuccess2
                            });
                        }
                    }
                } else {
                    Logger.add('[RECOVERY] Recovery validated successfully');
                }

                // Resume playback if needed AND recovery was successful
                if (video.paused) {
                    if (recoverySuccess.isValid) {
                        Logger.add('[RECOVERY] Recovery validated - attempting playback');
                        await PlayRetryHandler.retry(video, 'post-recovery');
                    } else {
                        Logger.add('[RECOVERY] Skipping play retry - recovery validation failed');
                    }
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, {
                    status: recoverySuccess.isValid ? 'SUCCESS' : 'FAILED'
                });
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
