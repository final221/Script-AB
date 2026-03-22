// @module CatchUpController
// @depends BufferGapFinder, SeekTargetCalculator, VideoStateSnapshot, LogEvents
// --- CatchUpController ---
/**
 * Schedules catch-up seeks toward the live edge after healing.
 */
const CatchUpController = (() => {
    const create = () => {
        const getProfile = (reason) => {
            if (reason === 'post_no_heal') {
                return {
                    delayMs: CONFIG.recovery.CATCH_UP_POST_NO_HEAL_DELAY_MS,
                    stableMs: CONFIG.recovery.CATCH_UP_POST_NO_HEAL_STABLE_MS,
                    progressMs: CONFIG.recovery.CATCH_UP_POST_NO_HEAL_PROGRESS_MS
                };
            }
            return {
                delayMs: CONFIG.recovery.CATCH_UP_DELAY_MS,
                stableMs: CONFIG.recovery.CATCH_UP_STABLE_MS,
                progressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS
            };
        };

        const scheduleCatchUp = (video, monitorState, videoId, reason) => {
            if (!monitorState || monitorState.catchUpTimeoutId) return;
            monitorState.catchUpAttempts = 0;
            const profile = getProfile(reason);
            Logger.add(LogEvents.tagged('CATCH_UP', 'Scheduled'), {
                reason,
                delayMs: profile.delayMs,
                stableMs: profile.stableMs,
                progressMs: profile.progressMs,
                videoState: VideoStateSnapshot.forLog(video, videoId)
            });
            monitorState.catchUpTimeoutId = setTimeout(() => {
                attemptCatchUp(video, monitorState, videoId, reason);
            }, profile.delayMs);
        };

        const attemptCatchUp = (video, monitorState, videoId, reason) => {
            if (!monitorState) return;
            monitorState.catchUpTimeoutId = null;
            monitorState.catchUpAttempts += 1;

            if (!document.contains(video)) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (detached)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts
                });
                return;
            }

            const now = Date.now();
            const profile = getProfile(reason);
            const stallAgoMs = monitorState.lastStallEventTime
                ? (now - monitorState.lastStallEventTime)
                : null;
            const progressOk = monitorState.progressStreakMs >= profile.progressMs;
            const stableEnough = !video.paused
                && video.readyState >= 3
                && progressOk
                && (stallAgoMs === null || stallAgoMs >= profile.stableMs);

            if (!stableEnough) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Deferred (unstable)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts,
                    paused: video.paused,
                    readyState: video.readyState,
                    progressStreakMs: monitorState.progressStreakMs,
                    stallAgoMs,
                    requiredStableMs: profile.stableMs,
                    requiredProgressMs: profile.progressMs
                });
                if (monitorState.catchUpAttempts < CONFIG.recovery.CATCH_UP_MAX_ATTEMPTS) {
                    monitorState.catchUpTimeoutId = setTimeout(() => {
                        attemptCatchUp(video, monitorState, videoId, reason);
                    }, CONFIG.recovery.CATCH_UP_RETRY_MS);
                }
                return;
            }

            const ranges = BufferGapFinder.getBufferRanges(video);
            if (!ranges.length) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (no buffer)'), {
                    reason,
                    attempts: monitorState.catchUpAttempts
                });
                return;
            }

            const liveRange = ranges[ranges.length - 1];
            const bufferEnd = liveRange.end;
            const behindS = bufferEnd - video.currentTime;

            if (behindS < CONFIG.recovery.CATCH_UP_MIN_S) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (already near live)'), {
                    reason,
                    behindS: behindS.toFixed(2)
                });
                return;
            }

            const target = Math.max(video.currentTime, bufferEnd - CONFIG.recovery.HEAL_EDGE_GUARD_S);
            const validation = SeekTargetCalculator.validateSeekTarget(video, target);
            const bufferRanges = BufferGapFinder.formatRanges(ranges);

            if (!validation.valid) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Skipped (invalid target)'), {
                    reason,
                    target: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges,
                    validation: validation.reason
                });
                return;
            }

            try {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Seeking toward live edge'), {
                    reason,
                    from: video.currentTime.toFixed(3),
                    to: target.toFixed(3),
                    behindS: behindS.toFixed(2),
                    bufferRanges
                });
                video.currentTime = target;
                monitorState.lastCatchUpTime = now;
            } catch (error) {
                Logger.add(LogEvents.tagged('CATCH_UP', 'Seek failed'), {
                    reason,
                    error: error?.name,
                    message: error?.message
                });
            }
        };

        return { scheduleCatchUp };
    };

    return { create };
})();
