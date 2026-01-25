// --- CandidatePruner ---
/**
 * Enforces the monitor cap by pruning the worst candidate.
 */
const CandidatePruner = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const logDebug = options.logDebug;
        const maxMonitors = options.maxMonitors;
        const scoreVideo = options.scoreVideo;
        const getActiveId = options.getActiveId;
        const getLastGoodId = options.getLastGoodId;

        const pruneMonitors = (excludeId, stopMonitoring) => {
            if (monitorsById.size <= maxMonitors) return;

            const protectedIds = new Set();
            const activeCandidateId = getActiveId();
            const lastGoodCandidateId = getLastGoodId();
            if (activeCandidateId) protectedIds.add(activeCandidateId);
            if (lastGoodCandidateId) protectedIds.add(lastGoodCandidateId);

            let worst = null;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                if (protectedIds.has(videoId)) continue;
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                if (!worst || result.score < worst.score) {
                    worst = { id: videoId, entry, score: result.score };
                }
            }

            if (worst) {
                Logger.add(LogEvents.tagged('PRUNE', 'Stopped monitor due to cap'), {
                    videoId: worst.id,
                    score: worst.score,
                    maxMonitors
                });
                stopMonitoring(worst.entry.video);
            } else {
                logDebug(LogEvents.tagged('PRUNE_SKIP', 'All candidates protected'), {
                    protected: Array.from(protectedIds),
                    maxMonitors,
                    totalMonitors: monitorsById.size
                });
            }
        };

        return { pruneMonitors };
    };

    return { create };
})();
