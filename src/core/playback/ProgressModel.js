// @module ProgressModel
// @depends PlaybackMonitor
// --- ProgressModel ---
/**
 * Canonical progress classification helpers shared across recovery flows.
 */
const ProgressModel = (() => {
    const toFinite = (value) => (Number.isFinite(value) ? value : null);

    const buildSnapshot = (video, monitorState, nowMs = Date.now()) => {
        const currentTime = toFinite(video?.currentTime);
        const readyState = toFinite(video?.readyState);
        const paused = typeof video?.paused === 'boolean' ? video.paused : null;
        const lastProgressTime = toFinite(monitorState?.lastProgressTime);
        const progressStreakMs = toFinite(monitorState?.progressStreakMs) || 0;
        const hasProgress = Boolean(monitorState?.hasProgress) || lastProgressTime !== null;

        return {
            nowMs,
            currentTime,
            paused,
            readyState,
            lastProgressTime,
            progressStreakMs,
            hasProgress
        };
    };

    const captureActionBaseline = (video, monitorState, actionStartMs = Date.now()) => ({
        actionStartMs,
        baselineCurrentTime: toFinite(video?.currentTime),
        baselineProgressTime: toFinite(monitorState?.lastProgressTime) || 0
    });

    const evaluate = (snapshot, options = {}) => {
        const nowMs = toFinite(options.nowMs) || toFinite(snapshot?.nowMs) || Date.now();
        const currentTime = toFinite(snapshot?.currentTime);
        const paused = typeof snapshot?.paused === 'boolean' ? snapshot.paused : null;
        const readyState = toFinite(snapshot?.readyState);
        const lastProgressTime = toFinite(snapshot?.lastProgressTime);
        const progressStreakMs = toFinite(snapshot?.progressStreakMs) || 0;
        const hasProgress = Boolean(snapshot?.hasProgress) || lastProgressTime !== null;

        const minDeltaS = toFinite(options.minDeltaS) || CONFIG.monitoring.PROGRESS_MIN_DELTA_S || 0.05;
        const recentWindowMs = toFinite(options.recentWindowMs) || CONFIG.monitoring.PROGRESS_RECENT_MS;
        const sustainedWindowMs = toFinite(options.sustainedWindowMs) || CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS;
        const actionStartMs = toFinite(options.actionStartMs);
        const baselineCurrentTime = toFinite(options.baselineCurrentTime);
        const baselineProgressTime = toFinite(options.baselineProgressTime) || 0;
        const previousCurrentTime = toFinite(options.previousCurrentTime);
        const requireSustained = options.requireSustained === true;

        const mediaReady = paused !== true
            && (readyState === null || readyState >= 2);
        const comparisonCurrentTime = baselineCurrentTime !== null
            ? baselineCurrentTime
            : previousCurrentTime;
        const currentTimeDeltaS = (
            currentTime !== null && comparisonCurrentTime !== null
        )
            ? Number((currentTime - comparisonCurrentTime).toFixed(3))
            : null;

        const raw_progress = mediaReady
            && currentTimeDeltaS !== null
            && currentTimeDeltaS > minDeltaS;
        const recent_progress = lastProgressTime !== null
            && (nowMs - lastProgressTime) <= recentWindowMs;
        const sustained_progress = progressStreakMs >= sustainedWindowMs;
        const action_progress = mediaReady
            && hasProgress
            && actionStartMs !== null
            && lastProgressTime !== null
            && lastProgressTime > Math.max(actionStartMs, baselineProgressTime)
            && currentTimeDeltaS !== null
            && currentTimeDeltaS > minDeltaS;

        return {
            mediaReady,
            raw_progress,
            recent_progress,
            sustained_progress,
            action_progress,
            candidate_viable: recent_progress || sustained_progress,
            action_succeeded: action_progress && (!requireSustained || sustained_progress),
            currentTimeDeltaS,
            minDeltaS,
            recentWindowMs,
            sustainedWindowMs
        };
    };

    const evaluateVideo = (video, monitorState, options = {}) => {
        const nowMs = toFinite(options.nowMs) || Date.now();
        const snapshot = buildSnapshot(video, monitorState, nowMs);
        return evaluate(snapshot, { ...options, nowMs });
    };

    const hasActionProgress = (video, monitorState, baseline = {}, options = {}) => {
        const evaluation = evaluateVideo(video, monitorState, {
            ...options,
            actionStartMs: baseline.actionStartMs,
            baselineCurrentTime: baseline.baselineCurrentTime,
            baselineProgressTime: baseline.baselineProgressTime
        });
        return evaluation.action_progress;
    };

    return {
        buildSnapshot,
        captureActionBaseline,
        evaluate,
        evaluateVideo,
        hasActionProgress
    };
})();
