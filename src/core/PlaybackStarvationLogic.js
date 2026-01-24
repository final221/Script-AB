// --- PlaybackStarvationLogic ---
/**
 * Buffer starvation tracking helper.
 */
const PlaybackStarvationLogic = (() => {
    const create = (options = {}) => {
        const state = options.state;
        const logDebugLazy = options.logDebugLazy || (() => {});

        const updateBufferStarvation = (bufferInfo, reason, nowOverride) => {
            const now = Number.isFinite(nowOverride) ? nowOverride : Date.now();
            if (!bufferInfo) return false;

            let bufferAhead = bufferInfo.bufferAhead;
            if (!Number.isFinite(bufferAhead)) {
                if (bufferInfo.hasBuffer) {
                    bufferAhead = 0;
                } else {
                    state.lastBufferAhead = null;
                    return false;
                }
            }

            const prevBufferAhead = state.lastBufferAhead;
            state.lastBufferAhead = bufferAhead;
            state.lastBufferAheadUpdateTime = now;
            if (Number.isFinite(bufferAhead)) {
                if (Number.isFinite(prevBufferAhead)) {
                    if (bufferAhead > prevBufferAhead + 0.05) {
                        state.lastBufferAheadIncreaseTime = now;
                    }
                } else if (bufferAhead > 0) {
                    state.lastBufferAheadIncreaseTime = now;
                }
            }

            if (bufferAhead <= CONFIG.stall.BUFFER_STARVE_THRESHOLD_S) {
                if (!state.bufferStarvedSince) {
                    state.bufferStarvedSince = now;
                }

                const starvedForMs = now - state.bufferStarvedSince;
                if (!state.bufferStarved && starvedForMs >= CONFIG.stall.BUFFER_STARVE_CONFIRM_MS) {
                    state.bufferStarved = true;
                    state.bufferStarveUntil = now + CONFIG.stall.BUFFER_STARVE_BACKOFF_MS;
                    state.lastBufferStarveLogTime = now;
                    logDebugLazy(LogEvents.tagged('STARVE', 'Buffer starvation detected'), () => ({
                        reason,
                        bufferAhead: bufferAhead.toFixed(3),
                        threshold: CONFIG.stall.BUFFER_STARVE_THRESHOLD_S,
                        confirmMs: CONFIG.stall.BUFFER_STARVE_CONFIRM_MS,
                        backoffMs: CONFIG.stall.BUFFER_STARVE_BACKOFF_MS
                    }));
                } else if (state.bufferStarved
                    && (now - state.lastBufferStarveLogTime) >= CONFIG.logging.STARVE_LOG_MS) {
                    state.lastBufferStarveLogTime = now;
                    if (now >= state.bufferStarveUntil) {
                        state.bufferStarveUntil = now + CONFIG.stall.BUFFER_STARVE_BACKOFF_MS;
                    }
                    logDebugLazy(LogEvents.tagged('STARVE', 'Buffer starvation persists'), () => ({
                        reason,
                        bufferAhead: bufferAhead.toFixed(3),
                        starvedForMs,
                        nextHealAllowedInMs: Math.max(state.bufferStarveUntil - now, 0)
                    }));
                }
                return state.bufferStarved;
            }

            if (state.bufferStarved || state.bufferStarvedSince) {
                const starvedForMs = state.bufferStarvedSince ? (now - state.bufferStarvedSince) : null;
                state.bufferStarved = false;
                state.bufferStarvedSince = 0;
                state.bufferStarveUntil = 0;
                state.lastBufferStarveLogTime = 0;
                state.lastBufferStarveSkipLogTime = 0;
                logDebugLazy(LogEvents.tagged('STARVE_CLEAR', 'Buffer starvation cleared'), () => ({
                    reason,
                    starvedForMs,
                    bufferAhead: bufferAhead.toFixed(3)
                }));
            }

            return false;
        };

        return { updateBufferStarvation };
    };

    return { create };
})();
