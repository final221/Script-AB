// --- HealPointPoller ---
/**
 * Polls for heal points and detects self-recovery.
 */
const HealPointPoller = (() => {
    const LOG = {
        POLL_START: '[HEALER:POLL_START]',
        POLL_SUCCESS: '[HEALER:POLL_SUCCESS]',
        POLL_TIMEOUT: '[HEALER:POLL_TIMEOUT]',
        POLLING: '[HEALER:POLLING]',
        SELF_RECOVERED: '[HEALER:SELF_RECOVERED]'
    };

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

            logWithState(LOG.POLL_START, video, {
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
                    logWithState(LOG.SELF_RECOVERED, video, {
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
                    Logger.add(LOG.POLL_SUCCESS, {
                        attempts: pollCount,
                        type: healPoint.isNudge ? 'NUDGE' : 'GAP',
                        elapsed: (Date.now() - startTime) + 'ms',
                        healPoint: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                        bufferSize: (healPoint.end - healPoint.start).toFixed(2) + 's'
                    });
                    return {
                        healPoint,
                        aborted: false
                    };
                }

                if (pollCount % 25 === 0) {
                    logDebug(LOG.POLLING, {
                        attempt: pollCount,
                        elapsed: (Date.now() - startTime) + 'ms',
                        buffers: BufferGapFinder.formatRanges(BufferGapFinder.getBufferRanges(video))
                    });
                }

                await Fn.sleep(CONFIG.stall.HEAL_POLL_INTERVAL_MS);
            }

            Logger.add(LOG.POLL_TIMEOUT, {
                attempts: pollCount,
                elapsed: (Date.now() - startTime) + 'ms',
                finalState: VideoState.get(video, getVideoId(video))
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
