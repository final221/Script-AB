// @module FailoverCandidatePicker
// --- FailoverCandidatePicker ---
/**
 * Chooses a failover candidate from monitored videos.
 */
const FailoverCandidatePicker = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const scoreVideo = options.scoreVideo;
        const minReadyState = 2;
        const isViableUntrusted = (result = {}) => {
            if (result.deadCandidate) return false;
            const readyState = result?.vs?.readyState ?? 0;
            const src = result?.vs?.currentSrc || result?.vs?.src || '';
            if (!src) return false;
            return readyState >= minReadyState;
        };

        const getVideoIndex = (videoId) => {
            const match = /video-(\d+)/.exec(videoId);
            return match ? Number(match[1]) : -1;
        };

        const selectPreferred = (excludeId, excludeIds = null) => {
            const excluded = excludeIds instanceof Set ? excludeIds : new Set();
            if (typeof scoreVideo === 'function') {
                let bestTrusted = null;
                let bestViableUntrusted = null;
                for (const [videoId, entry] of monitorsById.entries()) {
                    if (videoId === excludeId || excluded.has(videoId)) continue;
                    const result = scoreVideo(entry.video, entry.monitor, videoId);
                    const candidate = { id: videoId, entry, score: result.score, result };

                    if (CandidateTrust.isTrusted(result) && (!bestTrusted || result.score > bestTrusted.score)) {
                        bestTrusted = candidate;
                        continue;
                    }
                    if (isViableUntrusted(result)
                        && (!bestViableUntrusted || result.score > bestViableUntrusted.score)) {
                        bestViableUntrusted = candidate;
                    }
                }
                if (bestTrusted) {
                    return {
                        ...bestTrusted,
                        selectionMode: 'trusted'
                    };
                }
                if (bestViableUntrusted) {
                    return {
                        ...bestViableUntrusted,
                        selectionMode: 'viable_untrusted_fallback'
                    };
                }
                return null;
            }

            let newest = null;
            let newestIndex = -1;
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === excludeId || excluded.has(videoId)) continue;
                const idx = getVideoIndex(videoId);
                if (idx > newestIndex) {
                    newestIndex = idx;
                    newest = { id: videoId, entry };
                }
            }
            return newest
                ? { ...newest, selectionMode: 'newest' }
                : null;
        };

        return { selectPreferred };
    };

    return { create };
})();
