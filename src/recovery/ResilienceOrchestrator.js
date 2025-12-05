// --- Resilience Orchestrator ---
/**
 * Orchestrates recovery execution.
 * REFACTORED: Simplified recovery with comprehensive logging.
 * - Removed page reload fallback (was destroying player)
 * - Added detailed state logging at every decision point
 * - Passive approach: log, try gentle recovery, let player self-heal
 */
const ResilienceOrchestrator = (() => {
    // Helper to capture complete video state for logging
    const captureVideoState = (video) => {
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };

        let bufferedRanges = [];
        try {
            for (let i = 0; i < video.buffered.length; i++) {
                bufferedRanges.push({
                    start: video.buffered.start(i).toFixed(2),
                    end: video.buffered.end(i).toFixed(2)
                });
            }
        } catch (e) {
            bufferedRanges = ['error reading buffer'];
        }

        return {
            currentTime: video.currentTime?.toFixed(3),
            duration: video.duration?.toFixed(3) || 'unknown',
            paused: video.paused,
            ended: video.ended,
            readyState: video.readyState,
            networkState: video.networkState,
            error: video.error ? { code: video.error.code, message: video.error.message } : null,
            buffered: bufferedRanges,
            playbackRate: video.playbackRate,
            muted: video.muted,
            volume: video.volume?.toFixed(2),
            srcType: video.src ? (video.src.startsWith('blob:') ? 'blob' : 'url') : 'none'
        };
    };

    return {
        /**
         * Main entry point for recovery.
         * @param {HTMLElement} container - The player container
         * @param {Object} payload - Event payload containing reason and flags
         * @returns {Promise<boolean>} True if recovery was successful
         */
        execute: async (container, payload = {}) => {
            const startTime = performance.now();
            const reason = payload.reason || 'unknown';
            const source = payload.source || 'UNKNOWN';

            // ========== ENTRY LOGGING ==========
            const video = Adapters.DOM.find('video');
            Logger.add('[RECOVERY:ENTER] Recovery triggered', {
                source,
                trigger: payload.trigger,
                reason,
                forceAggressive: !!payload.forceAggressive,
                forceExperimental: !!payload.forceExperimental,
                videoState: captureVideoState(video)
            });

            // 1. Concurrency Guard
            if (!RecoveryLock.acquire()) {
                Logger.add('[RECOVERY:BLOCKED] Already in progress', {
                    reason: 'concurrent_recovery',
                    source
                });
                return false;
            }

            try {
                if (!video) {
                    Logger.add('[RECOVERY:ABORT] No video element', { source });
                    return false;
                }

                // 2. Check if already healthy
                const alreadyHealthy = !payload.forceAggressive &&
                    !payload.forceExperimental &&
                    RecoveryValidator.detectAlreadyHealthy(video);

                if (alreadyHealthy) {
                    Logger.add('[RECOVERY:SKIP] Video already healthy', {
                        reason,
                        state: captureVideoState(video)
                    });
                    return true;
                }

                // 3. A/V Sync Routing
                if (AVSyncRouter.shouldRouteToAVSync(reason)) {
                    Logger.add('[RECOVERY:ROUTE] Routing to AVSync recovery', { reason });
                    const result = await AVSyncRouter.executeAVSyncRecovery();
                    Logger.add('[RECOVERY:ROUTE_RESULT] AVSync recovery completed', {
                        success: result,
                        finalState: captureVideoState(video)
                    });
                    return result;
                }

                // 4. Pre-recovery Snapshot
                const preSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);
                Logger.add('[RECOVERY:PRE_STATE] Before recovery', { preSnapshot });

                // 5. Buffer Analysis
                const bufferHealth = BufferAnalyzer.analyze(video);
                Logger.add('[RECOVERY:BUFFER] Buffer analysis', {
                    bufferHealth: bufferHealth?.bufferHealth,
                    bufferSize: bufferHealth?.bufferSize?.toFixed(2),
                    needsAggressive: bufferHealth?.needsAggressive
                });

                // 5.5 Strategy Selection (DISABLED aggressive escalation)
                // Previously: if critical buffer, force aggressive
                // NOW: Log but don't escalate - aggressive recovery destroys player
                if (bufferHealth && bufferHealth.bufferHealth === 'critical') {
                    Logger.add('[RECOVERY:DECISION] Critical buffer detected - would have escalated', {
                        action: 'SKIPPED_ESCALATION',
                        reason: 'Aggressive recovery disabled - causes player destruction'
                    });
                    // payload.forceAggressive = true; // DISABLED
                }

                const strategy = RecoveryStrategy.select(video, payload);
                Logger.add('[RECOVERY:STRATEGY] Strategy selected', {
                    name: strategy?.name || 'unknown',
                    wasForced: payload.forceAggressive || payload.forceExperimental
                });

                // 6. Execute Strategy
                await strategy.execute(video);

                // 7. Post-recovery Analysis
                const postSnapshot = VideoSnapshotHelper.captureVideoSnapshot(video);
                const delta = VideoSnapshotHelper.calculateRecoveryDelta(preSnapshot, postSnapshot);
                const validation = RecoveryValidator.validateRecoverySuccess(preSnapshot, postSnapshot, delta);

                Logger.add('[RECOVERY:POST_STATE] After recovery', {
                    valid: validation.isValid,
                    hasImprovement: validation.hasImprovement,
                    issues: validation.issues,
                    delta,
                    postSnapshot
                });

                // 8. Escalation Decision (DISABLED destructive escalation)
                if (!validation.isValid) {
                    Logger.add('[RECOVERY:ESCALATION] Recovery ineffective', {
                        action: 'GENTLE_BUFFER_SEEK',
                        reason: 'Aggressive escalation disabled'
                    });

                    // Only try gentle buffer seek - no aggressive recovery
                    if (video.buffered.length > 0) {
                        try {
                            const end = video.buffered.end(video.buffered.length - 1);
                            const target = Math.max(video.currentTime, end - 2);
                            video.currentTime = target;
                            Logger.add('[RECOVERY:SEEK] Jumped to buffer end', {
                                from: preSnapshot.currentTime?.toFixed(2),
                                to: target.toFixed(2),
                                bufferEnd: end.toFixed(2)
                            });
                        } catch (e) {
                            Logger.add('[RECOVERY:SEEK_FAILED] Buffer seek failed', { error: e.message });
                        }
                    }
                }

                // 9. Play Retry Decision
                const shouldRetryPlay = video.paused || validation.hasImprovement;
                Logger.add('[RECOVERY:PLAY_DECISION] Play retry evaluation', {
                    shouldRetry: shouldRetryPlay,
                    videoPaused: video.paused,
                    hasImprovement: validation.hasImprovement,
                    readyState: video.readyState
                });

                let playSuccess = false;
                if (shouldRetryPlay) {
                    playSuccess = await PlayRetryHandler.retry(video, 'post-recovery');
                    Logger.add('[RECOVERY:PLAY_RESULT] Play retry completed', {
                        success: playSuccess,
                        finalPaused: video.paused,
                        finalReadyState: video.readyState
                    });
                }

                // 10. Final State (REMOVED page reload - was destroying player)
                const duration = (performance.now() - startTime).toFixed(0);
                const finalState = captureVideoState(video);

                if (!playSuccess && !validation.isValid && video.paused) {
                    // Previously: window.location.reload()
                    // NOW: Just log and let player potentially self-recover
                    Logger.add('[RECOVERY:INCOMPLETE] Recovery did not fully succeed', {
                        duration: duration + 'ms',
                        action: 'LETTING_PLAYER_SELF_HEAL',
                        reason: 'Page reload disabled - was destroying player',
                        suggestion: 'User may need to manually refresh if stream stuck',
                        finalState
                    });
                } else {
                    Logger.add('[RECOVERY:EXIT] Recovery completed', {
                        duration: duration + 'ms',
                        success: validation.isValid,
                        playSuccess,
                        finalState
                    });
                }

                return validation.isValid;

            } catch (error) {
                Logger.add('[RECOVERY:ERROR] Critical error during recovery', {
                    message: error.message,
                    stack: error.stack?.split('\n').slice(0, 5),
                    videoState: captureVideoState(video)
                });
                return false;
            } finally {
                RecoveryLock.release();
                Logger.add('[RECOVERY:LOCK] Lock released');
            }
        }
    };
})();

