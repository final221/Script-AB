// --- HealPointPoller ---
/**
 * Polls for heal points and detects self-recovery.
 */
const HealPointPoller = (() => {
    const create = (options) => {
        const getVideoId = options.getVideoId;
        const logWithState = options.logWithState;
        const logDebug = options.logDebug;
        const shouldAbort = options.shouldAbort || (() => false);

        const hasRecovered = (video, monitorState) => {
            if (!video || !monitorState) return false;
            return Date.now() - monitorState.lastProgressTime < CONFIG.stall.RECOVERY_WINDOW_MS;
        };

        const pollForHealPoint = async (video, monitorState, timeoutMs) => {
            const startTime = Date.now();
            let pollCount = 0;
            const videoId = getVideoId(video);

            logWithState(LogEvents.TAG.POLL_START, video, {
                timeout: timeoutMs + 'ms'
            });

            const resetDeferTracking = () => {
                if (!monitorState) return;
                monitorState.healDeferSince = 0;
                monitorState.healDeferCount = 0;
            };
            resetDeferTracking();

            while (Date.now() - startTime < timeoutMs) {
                pollCount++;
                let analysis = null;
                const getAnalysis = () => {
                    if (!analysis) analysis = BufferGapFinder.analyze(video);
                    return analysis;
                };

                const abortReason = shouldAbort(video, monitorState);
                if (abortReason) {
                    return {
                        healPoint: null,
                        aborted: true,
                        reason: typeof abortReason === 'string' ? abortReason : 'abort'
                    };
                }

                if (hasRecovered(video, monitorState)) {
                    logWithState(LogEvents.TAG.SELF_RECOVERED, video, {
                        pollCount,
                        elapsed: (Date.now() - startTime) + 'ms'
                    });
                    resetDeferTracking();
                    return {
                        healPoint: null,
                        aborted: false
                    };
                }

                const healPoint = BufferGapFinder.findHealPoint(video, { silent: true });

                if (healPoint) {
                    const headroom = healPoint.end - healPoint.start;
                    if (headroom < CONFIG.recovery.MIN_HEAL_HEADROOM_S) {
                        const gapOverrideMin = CONFIG.recovery.GAP_OVERRIDE_MIN_GAP_S || 0;
                        const gapHeadroomMin = CONFIG.recovery.GAP_OVERRIDE_MIN_HEADROOM_S || 0;
                        const gapSize = healPoint.gapSize || 0;
                        const isGap = !healPoint.isNudge && gapSize > 0 && (healPoint.rangeIndex || 0) > 0;
                        const bufferExhausted = getAnalysis().bufferExhausted;
                        const canOverrideGap = isGap && gapSize >= gapOverrideMin && headroom >= gapHeadroomMin;
                        const canOverrideExhausted = bufferExhausted && headroom >= gapHeadroomMin;
                        const canOverride = canOverrideGap || canOverrideExhausted;
                        if (canOverride) {
                            Logger.add(LogEvents.tagged('GAP_OVERRIDE', 'Low headroom heal allowed'), {
                                bufferHeadroom: headroom.toFixed(2) + 's',
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                overrideMinHeadroom: gapHeadroomMin + 's',
                                gapSize: gapSize.toFixed(2) + 's',
                                minGap: gapOverrideMin + 's',
                                bufferExhausted,
                                overrideType: canOverrideGap ? 'gap' : 'buffer_exhausted',
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: getAnalysis().formattedRanges
                            });
                            resetDeferTracking();
                            return {
                                healPoint,
                                aborted: false
                            };
                        }

                        const now = Date.now();
                        if (monitorState) {
                            if (!monitorState.healDeferSince) {
                                monitorState.healDeferSince = now;
                            }
                            monitorState.healDeferCount = (monitorState.healDeferCount || 0) + 1;
                            const deferMs = now - monitorState.healDeferSince;
                            if (CONFIG.recovery.HEAL_DEFER_ABORT_MS
                                && deferMs >= CONFIG.recovery.HEAL_DEFER_ABORT_MS) {
                                Logger.add(LogEvents.tagged('HEAL_DEFER', 'Deferral limit reached, treating as no-heal point'), {
                                    bufferHeadroom: headroom.toFixed(2) + 's',
                                    minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                    deferMs,
                                    deferLimitMs: CONFIG.recovery.HEAL_DEFER_ABORT_MS,
                                    healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                    buffers: getAnalysis().formattedRanges
                                });
                                resetDeferTracking();
                                return {
                                    healPoint: null,
                                    aborted: false,
                                    reason: 'defer_limit'
                                };
                            }
                        }
                        if (monitorState && now - (monitorState.lastHealDeferralLogTime || 0) >= CONFIG.logging.HEAL_DEFER_LOG_MS) {
                            monitorState.lastHealDeferralLogTime = now;
                            const deferSummary = LogEvents.summary.healDefer({
                                bufferHeadroom: headroom,
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S,
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.analyze(video).formattedRanges
                            });
                            logDebug(deferSummary, {
                                bufferHeadroom: headroom.toFixed(2) + 's',
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: getAnalysis().formattedRanges
                            });
                        }
                        await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
                        continue;
                    }

                    resetDeferTracking();
                    Logger.add(LogEvents.TAG.POLL_SUCCESS, {
                        attempts: pollCount,
                        type: healPoint.isNudge ? 'NUDGE' : 'GAP',
                        elapsed: (Date.now() - startTime) + 'ms',
                        healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        bufferSize: headroom.toFixed(2) + 's'
                    });
                    return {
                        healPoint,
                        aborted: false
                    };
                }

                if (pollCount % 25 === 0) {
                    logDebug(LogEvents.TAG.POLLING, {
                        attempt: pollCount,
                        elapsed: (Date.now() - startTime) + 'ms',
                        buffers: getAnalysis().formattedRanges
                    });
                }

                await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
            }

            Logger.add(LogEvents.TAG.POLL_TIMEOUT, {
                attempts: pollCount,
                elapsed: (Date.now() - startTime) + 'ms',
                finalState: VideoStateSnapshot.forLog(video, videoId)
            });

            return {
                healPoint: null,
                aborted: false
            };
        };

        return {
            pollForHealPoint,
            hasRecovered
        };
    };

    return { create };
})();
