// --- ExternalSignalHandlerStall ---
/**
 * Handles playhead stall signals.
 */
const ExternalSignalHandlerStall = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const onStallDetected = options.onStallDetected || (() => {});
        const playheadAttribution = options.playheadAttribution;

        return (signal = {}, helpers = {}) => {
            const attribution = playheadAttribution.resolve(signal.playheadSeconds);
            if (!attribution.id) {
                Logger.add(LogEvents.tagged('STALL_HINT_UNATTRIBUTED', 'Console playhead stall warning'), {
                    level: signal.level || 'unknown',
                    message: helpers.truncateMessage(signal.message || ''),
                    playheadSeconds: attribution.playheadSeconds,
                    bufferEndSeconds: helpers.formatSeconds(signal.bufferEndSeconds),
                    activeVideoId: attribution.activeId,
                    reason: attribution.reason,
                    candidates: attribution.candidates
                });
                return true;
            }
            const active = helpers.getActiveEntry(candidateSelector, monitorsById);
            const entry = monitorsById.get(attribution.id);
            if (!entry) return true;
            const now = Date.now();
            const state = entry.monitor.state;
            state.lastStallEventTime = now;
            state.pauseFromStall = true;

            Logger.add(LogEvents.tagged('STALL_HINT', 'Console playhead stall warning'), {
                videoId: attribution.id,
                level: signal.level || 'unknown',
                message: helpers.truncateMessage(signal.message || ''),
                playheadSeconds: attribution.playheadSeconds,
                bufferEndSeconds: helpers.formatSeconds(signal.bufferEndSeconds),
                attribution: attribution.reason,
                activeVideoId: active ? active.id : null,
                deltaSeconds: attribution.match ? attribution.match.deltaSeconds : null,
                lastProgressAgoMs: state.lastProgressTime ? (now - state.lastProgressTime) : null,
                videoState: VideoStateSnapshot.forLog(entry.video, attribution.id)
            });

            AdGapSignals.maybeLog({
                video: entry.video,
                videoId: attribution.id,
                playheadSeconds: attribution.playheadSeconds,
                monitorState: state,
                now,
                reason: 'console_stall'
            });

            if (!state.hasProgress || !state.lastProgressTime) {
                return true;
            }

            const stalledForMs = now - state.lastProgressTime;
            if (stalledForMs >= CONFIG.stall.STALL_CONFIRM_MS) {
                onStallDetected(entry.video, {
                    trigger: 'CONSOLE_STALL',
                    stalledFor: stalledForMs + 'ms',
                    bufferExhausted: BufferGapFinder.isBufferExhausted(entry.video),
                    paused: entry.video.paused,
                    pauseFromStall: true
                }, state);
            }
            return true;
        };
    };

    return { create };
})();
