// --- PlaybackResetLogic ---
/**
 * Reset evaluation + pending reset handling for playback state.
 */
const PlaybackResetLogic = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId;
        const state = options.state;
        const logDebugLazy = options.logDebugLazy || (() => {});

        const evaluateResetState = (vs) => {
            const ranges = BufferGapFinder.getBufferRanges(video);
            const hasBuffer = ranges.length > 0;
            const hasSrc = Boolean(vs.currentSrc || vs.src);
            const lowReadyState = vs.readyState <= 1;
            const isHardReset = !hasSrc && lowReadyState;
            const isSoftReset = lowReadyState
                && !hasBuffer
                && (vs.networkState === 0 || vs.networkState === 3);

            return {
                ranges,
                hasBuffer,
                hasSrc,
                lowReadyState,
                isHardReset,
                isSoftReset
            };
        };

        const clearResetPending = (reason, vs) => {
            if (!state.resetPendingAt) return false;
            const now = Date.now();
            logDebugLazy(() => {
                const snapshot = vs || VideoState.get(video, videoId);
                return {
                    message: LogEvents.tagged('RESET_CLEAR', 'Reset pending cleared'),
                    detail: {
                        reason,
                        pendingForMs: now - state.resetPendingAt,
                        graceMs: CONFIG.stall.RESET_GRACE_MS,
                        resetType: state.resetPendingType,
                        hasSrc: Boolean(snapshot.currentSrc || snapshot.src),
                        readyState: snapshot.readyState,
                        networkState: snapshot.networkState,
                        buffered: snapshot.buffered || BufferGapFinder.analyze(video).formattedRanges
                    }
                };
            });
            state.resetPendingAt = 0;
            state.resetPendingReason = null;
            state.resetPendingType = null;
            state.resetPendingCallback = null;
            return true;
        };

        const handleReset = (reason, onReset) => {
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            logDebugLazy(LogEvents.tagged('RESET_CHECK', 'Reset evaluation'), () => ({
                reason,
                hasSrc: resetState.hasSrc,
                readyState: vs.readyState,
                networkState: vs.networkState,
                bufferRanges: BufferGapFinder.formatRanges(resetState.ranges),
                lastSrc: state.lastSrc,
                hardReset: resetState.isHardReset,
                softReset: resetState.isSoftReset
            }));

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                logDebugLazy(LogEvents.tagged('RESET_SKIP', 'Reset suppressed'), () => ({
                    reason,
                    hasSrc: resetState.hasSrc,
                    readyState: vs.readyState,
                    networkState: vs.networkState,
                    hasBuffer: resetState.hasBuffer
                }));
                return;
            }

            if (!state.resetPendingAt) {
                state.resetPendingAt = Date.now();
                state.resetPendingReason = reason;
                state.resetPendingType = resetState.isHardReset ? 'hard' : 'soft';
                logDebugLazy(LogEvents.tagged('RESET_PENDING', 'Reset pending'), () => ({
                    reason,
                    resetType: state.resetPendingType,
                    graceMs: CONFIG.stall.RESET_GRACE_MS,
                    hasSrc: resetState.hasSrc,
                    hasBuffer: resetState.hasBuffer,
                    readyState: vs.readyState,
                    networkState: vs.networkState
                }));
            }
            state.resetPendingCallback = onReset;
        };

        const evaluateResetPending = (trigger) => {
            if (!state.resetPendingAt) {
                return false;
            }
            const now = Date.now();
            const vs = VideoState.get(video, videoId);
            const resetState = evaluateResetState(vs);

            if (!resetState.isHardReset && !resetState.isSoftReset) {
                clearResetPending(trigger || 'recovered', vs);
                return false;
            }

            const pendingForMs = now - state.resetPendingAt;
            if (pendingForMs < CONFIG.stall.RESET_GRACE_MS) {
                return true;
            }

            const pendingReason = state.resetPendingReason || trigger;
            const pendingType = state.resetPendingType || (resetState.isHardReset ? 'hard' : 'soft');

            PlaybackStateStore.setState(state, MonitorStates.RESET);
            logDebugLazy(LogEvents.tagged('RESET', 'Video reset'), () => ({
                reason: pendingReason,
                resetType: pendingType,
                pendingForMs,
                graceMs: CONFIG.stall.RESET_GRACE_MS,
                hasSrc: resetState.hasSrc,
                hasBuffer: resetState.hasBuffer,
                readyState: vs.readyState,
                networkState: vs.networkState
            }));

            const callback = state.resetPendingCallback;
            state.resetPendingAt = 0;
            state.resetPendingReason = null;
            state.resetPendingType = null;
            state.resetPendingCallback = null;

            if (typeof callback === 'function') {
                callback({
                    reason: pendingReason,
                    resetType: pendingType,
                    pendingForMs,
                    videoState: vs
                }, state);
            }

            return true;
        };

        return {
            evaluateResetState,
            clearResetPending,
            handleReset,
            evaluateResetPending
        };
    };

    return { create };
})();
