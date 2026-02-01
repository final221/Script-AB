// --- StallSkipPolicy ---
/**
 * Determines when stall handling should be skipped due to backoff or recovery windows.
 */
const StallSkipPolicy = (() => {
    const create = (options = {}) => {
        const backoffManager = options.backoffManager;

        const collectSelfRecoverSignals = (monitorState, decisionContext) => {
            if (!monitorState) return null;
            const stalledForMs = decisionContext.stalledForMs;
            const baseGraceMs = CONFIG.stall.SELF_RECOVER_GRACE_MS;
            const allowExtraGrace = !monitorState.bufferStarved;
            const extraGraceMs = allowExtraGrace ? (CONFIG.stall.SELF_RECOVER_EXTRA_MS || 0) : 0;
            const maxGraceMs = CONFIG.stall.SELF_RECOVER_MAX_MS || 0;
            const extendedGraceMs = maxGraceMs
                ? Math.min(baseGraceMs + extraGraceMs, maxGraceMs)
                : baseGraceMs + extraGraceMs;
            const maxMs = CONFIG.stall.SELF_RECOVER_MAX_MS;

            if (stalledForMs === null || (maxMs && stalledForMs > maxMs)) {
                return null;
            }

            const signals = [];
            const strongSignals = [];
            const now = decisionContext.now;
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

            if (signals.length === 0) return null;
            const useExtra = strongSignals.length > 0;
            const graceMs = useExtra ? extendedGraceMs : baseGraceMs;

            return {
                stalledForMs,
                graceMs,
                extraGraceMs: useExtra ? extraGraceMs : 0,
                signals,
                bufferAhead: monitorState.lastBufferAhead,
                bufferStarved: monitorState.bufferStarved || false
            };
        };

        const decide = (context) => {
            const policyContext = RecoveryContext.buildPolicyContext(context);
            const decisionContext = policyContext.decisionContext;
            const monitorState = policyContext.monitorState;
            const now = decisionContext.now;
            if (monitorState?.noHealPointQuietUntil && now < monitorState.noHealPointQuietUntil) {
                return RecoveryContext.buildDecision('stall_skip', policyContext, {
                    shouldSkip: true,
                    reason: 'quiet'
                });
            }
            const backoffStatus = backoffManager.getBackoffStatus(monitorState, now);
            if (backoffStatus.shouldSkip) {
                return RecoveryContext.buildDecision('stall_skip', policyContext, {
                    shouldSkip: true,
                    reason: 'backoff',
                    backoff: backoffStatus
                });
            }
            if (monitorState?.bufferStarveUntil && now < monitorState.bufferStarveUntil) {
                return RecoveryContext.buildDecision('stall_skip', policyContext, {
                    shouldSkip: true,
                    reason: 'buffer_starve',
                    bufferStarve: {
                        remainingMs: monitorState.bufferStarveUntil - now,
                        bufferAhead: monitorState.lastBufferAhead
                    }
                });
            }
            if (monitorState?.nextPlayHealAllowedTime && now < monitorState.nextPlayHealAllowedTime) {
                return RecoveryContext.buildDecision('stall_skip', policyContext, {
                    shouldSkip: true,
                    reason: 'play_backoff',
                    playBackoff: {
                        remainingMs: monitorState.nextPlayHealAllowedTime - now,
                        playErrorCount: monitorState.playErrorCount
                    }
                });
            }

            if (monitorState) {
                const selfRecover = collectSelfRecoverSignals(monitorState, decisionContext);
                if (selfRecover) {
                    return RecoveryContext.buildDecision('stall_skip', policyContext, {
                        shouldSkip: true,
                        reason: 'self_recover',
                        selfRecover
                    });
                }
            }

            return RecoveryContext.buildDecision('stall_skip', policyContext, {
                shouldSkip: false,
                reason: 'none'
            });
        };

        return { decide };
    };

    return { create };
})();
