// --- FailoverCandidatePicker ---
/**
 * Chooses a failover candidate from monitored videos.
 */
const FailoverCandidatePicker = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;

        const getVideoIndex = (videoId) => {
            const match = /video-(\d+)/.exec(videoId);
            return match ? Number(match[1]) : -1;
        };

        const selectNewest = (excludeId) => {
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

        return { selectNewest };
    };

    return { create };
})();
