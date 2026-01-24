// --- PlaybackLogHelper ---
/**
 * Shared logging helpers for playback-related modules.
 */
const PlaybackLogHelper = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId;
        const state = options.state;

        const buildStateChange = (fromState, toState, reason) => {
            const snapshot = StateSnapshot.full(video, videoId);
            const detail = {
                from: fromState,
                to: toState,
                reason,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                paused: snapshot?.paused,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered,
                lastProgressAgoMs: state?.lastProgressTime
                    ? (Date.now() - state.lastProgressTime)
                    : null,
                progressStreakMs: state?.progressStreakMs,
                progressEligible: state?.progressEligible,
                pauseFromStall: state?.pauseFromStall
            };
            const summary = LogEvents.summary.stateChange({
                videoId,
                ...detail
            });
            return { message: summary, detail };
        };

        const buildStallDuration = (reason, durationMs, bufferAhead) => {
            const snapshot = StateSnapshot.lite(video, videoId);
            const detail = {
                reason,
                durationMs,
                bufferAhead,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered
            };
            const summary = LogEvents.summary.stallDuration({
                videoId,
                reason,
                durationMs,
                bufferAhead,
                currentTime: detail.currentTime,
                readyState: detail.readyState,
                networkState: detail.networkState,
                buffered: snapshot?.bufferedLength
            });
            return { message: summary, detail };
        };

        const buildWatchdogNoProgress = (stalledForMs, bufferExhausted, pauseFromStall) => {
            const snapshot = StateSnapshot.full(video, videoId);
            const detail = {
                stalledForMs,
                bufferExhausted,
                state: state?.state,
                paused: video?.paused,
                pauseFromStall,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered
            };
            const summary = LogEvents.summary.watchdogNoProgress({
                videoId,
                stalledForMs,
                bufferExhausted,
                state: detail.state,
                paused: detail.paused,
                pauseFromStall,
                currentTime: detail.currentTime,
                readyState: detail.readyState,
                networkState: detail.networkState,
                buffered: detail.buffered
            });
            return { message: summary, detail };
        };

        return {
            buildStateChange,
            buildStallDuration,
            buildWatchdogNoProgress
        };
    };

    return { create };
})();
