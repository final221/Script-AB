// --- FailoverCandidatePicker ---
/**
 * Chooses a failover candidate from monitored videos.
 */
const FailoverCandidatePicker = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const scoreVideo = options.scoreVideo;

        const getVideoIndex = (videoId) => {
            const match = /video-(\d+)/.exec(videoId);
            return match ? Number(match[1]) : -1;
        };

        const isTrusted = (result) => {
            if (!result.progressEligible) return false;
            const badReasons = ['fallback_src', 'ended', 'not_in_dom', 'reset', 'error_state', 'error'];
            return !badReasons.some(reason => result.reasons.includes(reason));
        };

        const selectPreferred = (excludeId) => {
            if (typeof scoreVideo === 'function') {
                let best = null;
                let bestTrusted = null;
                for (const [videoId, entry] of monitorsById.entries()) {
                    if (videoId === excludeId) continue;
                    const result = scoreVideo(entry.video, entry.monitor, videoId);
                    const candidate = { id: videoId, entry, score: result.score, result };

                    if (!best || result.score > best.score) {
                        best = candidate;
                    }
                    if (isTrusted(result) && (!bestTrusted || result.score > bestTrusted.score)) {
                        bestTrusted = candidate;
                    }
                }
                return bestTrusted || best;
            }

            let newest = null;
            let newestIndex = -1;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                const idx = getVideoIndex(videoId);
                if (idx > newestIndex) {
                    newestIndex = idx;
                    newest = { id: videoId, entry };
                }
            }
            return newest;
        };

        return { selectPreferred };
    };

    return { create };
})();
