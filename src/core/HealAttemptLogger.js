// --- HealAttemptLogger ---
/**
 * Logging helper for heal attempts.
 */
const HealAttemptLogger = (() => {
    const create = () => {
        const logStart = (detail = {}) => {
            const snapshot = StateSnapshot.full(detail.video, detail.videoId);
            const lastProgressAgoMs = detail.monitorState?.lastProgressTime
                ? (Date.now() - detail.monitorState.lastProgressTime)
                : null;
            const startSummary = LogEvents.summary.healStart({
                attempt: detail.attempt,
                lastProgressAgoMs,
                currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                paused: snapshot?.paused,
                readyState: snapshot?.readyState,
                networkState: snapshot?.networkState,
                buffered: snapshot?.buffered
            });
            Logger.add(startSummary, {
                attempt: detail.attempt,
                lastProgressAgoMs: detail.monitorState ? lastProgressAgoMs : undefined,
                videoId: detail.videoId,
                videoState: snapshot
            });
        };

        const logSelfRecovered = (durationMs, video, videoId) => {
            Logger.add(LogEvents.tagged('SKIPPED', 'Video recovered, no heal needed'), {
                duration: durationMs + 'ms',
                finalState: VideoStateSnapshot.forLog(video, videoId)
            });
        };

        const logNoHealPoint = (durationMs, video, videoId) => {
            const noPointSummary = LogEvents.summary.noHealPoint({
                duration: durationMs,
                currentTime: video.currentTime,
                bufferRanges: BufferGapFinder.analyze(video).formattedRanges
            });
            Logger.add(noPointSummary, {
                duration: durationMs + 'ms',
                suggestion: 'User may need to refresh page',
                currentTime: video.currentTime?.toFixed(3),
                bufferRanges: BufferGapFinder.analyze(video).formattedRanges,
                finalState: VideoStateSnapshot.forLog(video, videoId)
            });
        };

        const logStaleRecovered = (durationMs) => {
            Logger.add(LogEvents.tagged('STALE_RECOVERED', 'Heal point gone, but video recovered'), {
                duration: durationMs + 'ms'
            });
        };

        const logStaleGone = (healPoint, video, videoId) => {
            Logger.add(LogEvents.tagged('STALE_GONE', 'Heal point disappeared before seek'), {
                original: `${healPoint.start.toFixed(2)}-${healPoint.end.toFixed(2)}`,
                finalState: VideoStateSnapshot.forLog(video, videoId)
            });
        };

        const logPointUpdated = (originalPoint, freshPoint) => {
            Logger.add(LogEvents.tagged('POINT_UPDATED', 'Using refreshed heal point'), {
                original: `${originalPoint.start.toFixed(2)}-${originalPoint.end.toFixed(2)}`,
                fresh: `${freshPoint.start.toFixed(2)}-${freshPoint.end.toFixed(2)}`,
                type: freshPoint.isNudge ? 'NUDGE' : 'GAP'
            });
        };

        const logRetry = (label, point) => {
            Logger.add(LogEvents.tagged('RETRY', 'Retrying heal'), {
                attempt: label,
                healRange: `${point.start.toFixed(2)}-${point.end.toFixed(2)}`,
                gapSize: point.gapSize?.toFixed(2),
                isNudge: point.isNudge
            });
        };

        const logRetrySkip = (video, reason) => {
            Logger.add(LogEvents.tagged('RETRY_SKIP', 'Retry skipped, no heal point available'), {
                reason,
                currentTime: video.currentTime?.toFixed(3),
                bufferRanges: BufferGapFinder.analyze(video).formattedRanges
            });
        };

        const logHealComplete = (detail = {}) => {
            const completeSummary = LogEvents.summary.healComplete({
                duration: detail.durationMs,
                healAttempts: detail.healAttempts,
                bufferEndDelta: detail.bufferEndDelta
            });
            Logger.add(completeSummary, {
                duration: detail.durationMs + 'ms',
                healAttempts: detail.healAttempts,
                bufferEndDelta: detail.bufferEndDelta !== null
                    ? detail.bufferEndDelta.toFixed(2) + 's'
                    : null,
                finalState: VideoStateSnapshot.forLog(detail.video, detail.videoId)
            });
        };

        const logAbortContext = (detail = {}) => {
            const bufferRanges = BufferGapFinder.analyze(detail.video).formattedRanges;
            Logger.add(LogEvents.tagged('ABORT_CONTEXT', 'Play aborted during heal'), {
                error: detail.result?.error,
                errorName: detail.result?.errorName,
                stalledForMs: detail.monitorState?.lastProgressTime
                    ? (Date.now() - detail.monitorState.lastProgressTime)
                    : null,
                bufferStarved: detail.monitorState?.bufferStarved || false,
                bufferStarvedSinceMs: detail.monitorState?.bufferStarvedSince
                    ? (Date.now() - detail.monitorState.bufferStarvedSince)
                    : null,
                bufferStarveUntilMs: detail.monitorState?.bufferStarveUntil
                    ? Math.max(detail.monitorState.bufferStarveUntil - Date.now(), 0)
                    : null,
                bufferAhead: detail.monitorState?.lastBufferAhead ?? null,
                bufferRanges,
                readyState: detail.video.readyState,
                networkState: detail.video.networkState
            });
        };

        const logHealFailed = (detail = {}) => {
            const failedSummary = LogEvents.summary.healFailed({
                duration: detail.durationMs,
                errorName: detail.result?.errorName,
                error: detail.result?.error,
                healRange: detail.finalPoint
                    ? `${detail.finalPoint.start.toFixed(2)}-${detail.finalPoint.end.toFixed(2)}`
                    : null,
                gapSize: detail.finalPoint?.gapSize,
                isNudge: detail.finalPoint?.isNudge
            });
            Logger.add(failedSummary, {
                duration: detail.durationMs + 'ms',
                error: detail.result?.error,
                errorName: detail.result?.errorName,
                healRange: detail.finalPoint
                    ? `${detail.finalPoint.start.toFixed(2)}-${detail.finalPoint.end.toFixed(2)}`
                    : null,
                isNudge: detail.finalPoint?.isNudge,
                gapSize: detail.finalPoint?.gapSize?.toFixed(2),
                finalState: VideoStateSnapshot.forLog(detail.video, detail.videoId)
            });
        };

        return {
            logStart,
            logSelfRecovered,
            logNoHealPoint,
            logStaleRecovered,
            logStaleGone,
            logPointUpdated,
            logRetry,
            logRetrySkip,
            logHealComplete,
            logAbortContext,
            logHealFailed
        };
    };

    return { create };
})();
