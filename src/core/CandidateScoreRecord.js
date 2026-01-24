// --- CandidateScoreRecord ---
/**
 * Standardizes candidate score and trust records.
 */
const CandidateScoreRecord = (() => {
    const buildScoreRecord = (videoId, entry, result, trustInfo) => ({
        id: videoId,
        score: result.score,
        progressAgoMs: result.progressAgoMs,
        progressStreakMs: result.progressStreakMs,
        progressEligible: result.progressEligible,
        paused: result.vs.paused,
        readyState: result.vs.readyState,
        hasSrc: Boolean(result.vs.currentSrc),
        deadCandidate: result.deadCandidate,
        state: entry.monitor.state.state,
        reasons: result.reasons,
        trusted: trustInfo.trusted,
        trustReason: trustInfo.reason
    });

    const buildCandidate = (videoId, entry, result, trustInfo) => ({
        id: videoId,
        state: entry.monitor.state.state,
        monitorState: entry.monitor.state,
        trusted: trustInfo.trusted,
        trustReason: trustInfo.reason,
        deadCandidate: result.deadCandidate,
        ...result
    });

    return {
        buildScoreRecord,
        buildCandidate
    };
})();
