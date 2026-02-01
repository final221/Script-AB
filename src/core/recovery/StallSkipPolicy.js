// --- StallSkipPolicy ---
/**
 * Determines when stall handling should be skipped due to backoff or recovery windows.
 */
const StallSkipPolicy = (() => {
    const create = (options = {}) => {
        const backoffManager = options.backoffManager;

        const decide = (context) => {
            const decisionContext = context.getDecisionContext
                ? context.getDecisionContext()
                : RecoveryContext.buildDecisionContext(context);
            const videoId = decisionContext.videoId;
            const monitorState = context.monitorState;
            const now = decisionContext.now;
            if (monitorState?.noHealPointQuietUntil && now < monitorState.noHealPointQuietUntil) {
                return { shouldSkip: true, reason: 'quiet', videoId, monitorState, now };
            }
            const backoffStatus = backoffManager.getBackoffStatus(monitorState, now);
            if (backoffStatus.shouldSkip) {
                return {
                    shouldSkip: true,
                    reason: 'backoff',
                    videoId,
                    monitorState,
                    now,
                    backoff: backoffStatus
                };
            }
            if (monitorState?.bufferStarveUntil && now < monitorState.bufferStarveUntil) {
                return {
                    shouldSkip: true,
                    reason: 'buffer_starve',
                    videoId,
                    monitorState,
                    now,
                    bufferStarve: {
                        remainingMs: monitorState.bufferStarveUntil - now,
                        bufferAhead: monitorState.lastBufferAhead
                    }
                };
            }
            if (monitorState?.nextPlayHealAllowedTime && now < monitorState.nextPlayHealAllowedTime) {
                return {
                    shouldSkip: true,
                    reason: 'play_backoff',
                    videoId,
                    monitorState,
                    now,
                    playBackoff: {
                        remainingMs: monitorState.nextPlayHealAllowedTime - now,
                        playErrorCount: monitorState.playErrorCount
                    }
                };
            }

            if (monitorState) {
                const stalledForMs = decisionContext.stalledForMs;
                const baseGraceMs = CONFIG.stall.SELF_RECOVER_GRACE_MS;
                const allowExtraGrace = !monitorState.bufferStarved;
                const extraGraceMs = allowExtraGrace ? (CONFIG.stall.SELF_RECOVER_EXTRA_MS || 0) : 0;
                const maxGraceMs = CONFIG.stall.SELF_RECOVER_MAX_MS || 0;
                const extendedGraceMs = maxGraceMs
                    ? Math.min(baseGraceMs + extraGraceMs, maxGraceMs)
                    : baseGraceMs + extraGraceMs;
                const maxMs = CONFIG.stall.SELF_RECOVER_MAX_MS;

                if (stalledForMs !== null && (!maxMs || stalledForMs <= maxMs)) {
                    const signals = [];
                    const strongSignals = [];
                    const lastProgressTime = monitorState?.lastProgressTime || 0;
                    const lastSrcChange = monitorState.lastSrcChangeTime || 0;
                    const lastReadyChange = monitorState.lastReadyStateChangeTime || 0;
                    const lastNetworkChange = monitorState.lastNetworkStateChangeTime || 0;
                    const lastBufferRangeChange = monitorState.lastBufferedLengthChangeTime || 0;
                    const lastBufferGrow = monitorState.lastBufferAheadIncreaseTime || 0;

                    const isWithin = (ts, windowMs) => (
                        ts > lastProgressTime && (now - ts) <= windowMs
                    );

                    if (isWithin(lastReadyChange, extendedGraceMs)) {
                        signals.push('ready_state');
                        strongSignals.push('ready_state');
                    }
                    if (isWithin(lastBufferGrow, extendedGraceMs)) {
                        signals.push('buffer_growth');
                        strongSignals.push('buffer_growth');
                    }
                    if (isWithin(lastSrcChange, baseGraceMs)) {
                        signals.push('src_change');
                    }
                    if (isWithin(lastNetworkChange, baseGraceMs)) {
                        signals.push('network_state');
                    }
                    if (isWithin(lastBufferRangeChange, baseGraceMs)) {
                        signals.push('buffer_ranges');
                    }

                    if (signals.length > 0) {
                        const graceMs = strongSignals.length > 0 ? extendedGraceMs : baseGraceMs;
                        return {
                            shouldSkip: true,
                            reason: 'self_recover',
                            videoId,
                            monitorState,
                            now,
                            selfRecover: {
                                stalledForMs,
                                graceMs,
                                extraGraceMs: strongSignals.length > 0 ? extraGraceMs : 0,
                                signals,
                                bufferAhead: monitorState.lastBufferAhead,
                                bufferStarved: monitorState.bufferStarved || false
                            }
                        };
                    }
                }
            }

            return { shouldSkip: false, reason: 'none', videoId, monitorState, now };
        };

        return { decide };
    };

    return { create };
})();
