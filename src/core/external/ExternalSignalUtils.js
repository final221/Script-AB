// --- ExternalSignalUtils ---
/**
 * Shared helpers for external signal handling.
 */
const ExternalSignalUtils = (() => {
    const formatSeconds = (value) => (
        Number.isFinite(value) ? Number(value.toFixed(3)) : null
    );
    const truncateMessage = (message) => (
        String(message).substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN)
    );
    const getActiveEntry = (candidateSelector, monitorsById) => {
        const activeId = candidateSelector.getActiveId();
        if (activeId && monitorsById.has(activeId)) {
            return { id: activeId, entry: monitorsById.get(activeId) };
        }
        const first = monitorsById.entries().next();
        if (!first.done) {
            return { id: first.value[0], entry: first.value[1] };
        }
        return null;
    };
    const logCandidateSnapshot = (candidateSelector, monitorsById, reason) => {
        const candidates = [];
        for (const [videoId, entry] of monitorsById.entries()) {
            const score = candidateSelector.scoreVideo(entry.video, entry.monitor, videoId);
            candidates.push({
                videoId,
                score: score.score,
                progressEligible: score.progressEligible,
                progressStreakMs: score.progressStreakMs,
                progressAgoMs: score.progressAgoMs,
                readyState: score.vs.readyState,
                bufferedLength: score.vs.bufferedLength,
                paused: score.vs.paused,
                currentSrc: score.vs.currentSrc,
                reasons: score.reasons
            });
        }
        Logger.add(LogEvents.tagged('CANDIDATE_SNAPSHOT', 'Candidates scored'), {
            reason,
            candidates
        });
    };
    const probeCandidates = (recoveryManager, monitorsById, reason, excludeId = null) => {
        if (!recoveryManager || typeof recoveryManager.probeCandidate !== 'function') {
            return;
        }
        const attempts = [];
        let attemptedCount = 0;
        for (const [videoId] of monitorsById.entries()) {
            if (videoId === excludeId) continue;
            const attempted = recoveryManager.probeCandidate(videoId, reason);
            attempts.push({ videoId, attempted });
            if (attempted) attemptedCount += 1;
        }
        Logger.add(LogEvents.tagged('PROBE_BURST', 'Probing candidates'), {
            reason,
            excludeId,
            attemptedCount,
            attempts
        });
    };

    return {
        formatSeconds,
        truncateMessage,
        getActiveEntry,
        logCandidateSnapshot,
        probeCandidates
    };
})();
