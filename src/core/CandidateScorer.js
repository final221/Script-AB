// --- CandidateScorer ---
/**
 * Scores a video candidate based on playback state.
 */
const CandidateScorer = (() => {
    const create = (options) => {
        const minProgressMs = options.minProgressMs;
        const isFallbackSource = options.isFallbackSource;

        const score = (video, monitor, videoId) => {
            const vs = VideoState.getLite(video, videoId);
            const state = monitor.state;
            const progressAgoMs = state.hasProgress && state.lastProgressTime
                ? Date.now() - state.lastProgressTime
                : null;
            const progressStreakMs = state.progressStreakMs || 0;
            const progressEligible = state.progressEligible
                || progressStreakMs >= minProgressMs;
            const deadCandidateUntil = state.deadCandidateUntil || 0;
            const deadCandidate = deadCandidateUntil > 0 && Date.now() < deadCandidateUntil;
            let score = 0;
            const reasons = [];

            if (!document.contains(video)) {
                score -= 10;
                reasons.push('not_in_dom');
            }

            if (vs.ended) {
                score -= 5;
                reasons.push('ended');
            }

            if (vs.errorCode) {
                score -= 3;
                reasons.push('error');
            }

            if (state.state === 'RESET') {
                score -= 3;
                reasons.push('reset');
            }

            if (state.resetPendingAt) {
                score -= 3;
                reasons.push('reset_pending');
            }

            if (state.state === 'ERROR') {
                score -= 2;
                reasons.push('error_state');
            }

            if (deadCandidate) {
                score -= 6;
                reasons.push('dead_candidate');
            }

            if (isFallbackSource(vs.currentSrc)) {
                score -= 4;
                reasons.push('fallback_src');
            }

            if (!vs.paused) {
                score += 2;
                reasons.push('playing');
            } else {
                score -= 1;
                reasons.push('paused');
            }

            if (vs.readyState >= 3) {
                score += 2;
                reasons.push('ready_high');
            } else if (vs.readyState >= 2) {
                score += 1;
                reasons.push('ready_mid');
            } else {
                score -= 1;
                reasons.push('ready_low');
            }

            if (progressAgoMs === null) {
                score -= 2;
                reasons.push('no_progress');
            } else if (progressAgoMs < CONFIG.monitoring.PROGRESS_RECENT_MS) {
                score += 3;
                reasons.push('recent_progress');
            } else if (progressAgoMs < CONFIG.monitoring.PROGRESS_STALE_MS) {
                score += 1;
                reasons.push('stale_progress');
            } else {
                score -= 1;
                reasons.push('no_progress');
            }

            if (!progressEligible) {
                score -= 3;
                reasons.push('progress_short');
            }

            if (vs.bufferedLength > 0) {
                score += 1;
                reasons.push('buffered');
            }

            const timeValue = Number.parseFloat(vs.currentTime);
            if (!Number.isNaN(timeValue) && timeValue > 0) {
                score += 1;
                reasons.push('time_nonzero');
            }

            return {
                score,
                reasons,
                vs,
                progressAgoMs,
                progressStreakMs,
                progressEligible,
                deadCandidate
            };
        };

        return { score };
    };

    return { create };
})();
