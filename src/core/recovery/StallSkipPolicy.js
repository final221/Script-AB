// --- StallSkipPolicy ---
/**
 * Determines when stall handling should be skipped due to backoff or recovery windows.
 */
const StallSkipPolicy = (() => {
    const create = (options = {}) => {
        const backoffManager = options.backoffManager;
        const logDebug = options.logDebug || (() => {});

        const shouldSkipStall = (context) => {
            const decisionContext = context.getDecisionContext
                ? context.getDecisionContext()
                : RecoveryContext.buildDecisionContext(context);
            const videoId = decisionContext.videoId;
            const monitorState = context.monitorState;
            const now = decisionContext.now;
            if (backoffManager.shouldSkip(videoId, monitorState)) {
                return true;
            }
            if (monitorState?.bufferStarveUntil && now < monitorState.bufferStarveUntil) {
                if (now - (monitorState.lastBufferStarveSkipLogTime || 0) > CONFIG.logging.STARVE_LOG_MS) {
                    monitorState.lastBufferStarveSkipLogTime = now;
                    logDebug(LogEvents.tagged('STARVE_SKIP', 'Stall skipped due to buffer starvation'), {
                        videoId,
                        remainingMs: monitorState.bufferStarveUntil - now,
                        bufferAhead: monitorState.lastBufferAhead !== null
                            ? monitorState.lastBufferAhead.toFixed(3)
                            : null
                    });
                }
                return true;
            }
            if (monitorState?.nextPlayHealAllowedTime && now < monitorState.nextPlayHealAllowedTime) {
                if (now - (monitorState.lastPlayBackoffLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                    monitorState.lastPlayBackoffLogTime = now;
                    logDebug(LogEvents.tagged('PLAY_BACKOFF', 'Stall skipped due to play backoff'), {
                        videoId,
                        remainingMs: monitorState.nextPlayHealAllowedTime - now,
                        playErrorCount: monitorState.playErrorCount
                    });
                }
                return true;
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
                        if (now - (monitorState.lastSelfRecoverSkipLogTime || 0) > CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
                            monitorState.lastSelfRecoverSkipLogTime = now;
                            logDebug(LogEvents.tagged('SELF_RECOVER_SKIP', 'Stall skipped for self-recovery window'), {
                                videoId,
                                stalledForMs,
                                graceMs,
                                extraGraceMs: strongSignals.length > 0 ? extraGraceMs : 0,
                                signals,
                                bufferAhead: monitorState.lastBufferAhead,
                                bufferStarved: monitorState.bufferStarved || false
                            });
                        }
                        return true;
                    }
                }
            }

            return false;
        };

        return { shouldSkipStall };
    };

    return { create };
})();
