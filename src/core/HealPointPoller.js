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

            while (Date.now() - startTime < timeoutMs) {
                pollCount++;

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
                        const canOverride = isGap && gapSize >= gapOverrideMin && headroom >= gapHeadroomMin;
                        if (canOverride) {
                            Logger.add(LogEvents.tagged('GAP_OVERRIDE', 'Low headroom gap heal allowed'), {
                                bufferHeadroom: headroom.toFixed(2) + 's',
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                overrideMinHeadroom: gapHeadroomMin + 's',
                                gapSize: gapSize.toFixed(2) + 's',
                                minGap: gapOverrideMin + 's',
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                            });
                            return {
                                healPoint,
                                aborted: false
                            };
                        }

                        const now = Date.now();
                        if (monitorState && now - (monitorState.lastHealDeferralLogTime || 0) >= CONFIG.logging.HEAL_DEFER_LOG_MS) {
                            monitorState.lastHealDeferralLogTime = now;
                            const deferSummary = LogEvents.summary.healDefer({
                                bufferHeadroom: headroom,
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S,
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                            });
                            logDebug(deferSummary, {
                                bufferHeadroom: headroom.toFixed(2) + 's',
                                minRequired: CONFIG.recovery.MIN_HEAL_HEADROOM_S + 's',
                                healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                                buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                            });
                        }
                        await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
                        continue;
                    }

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
                        buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
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
