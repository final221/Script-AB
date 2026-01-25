// --- PlayheadAttribution ---
/**
 * Resolves console playhead stall hints to a monitored video candidate.
 */
const PlayheadAttribution = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const matchWindowSeconds = Number.isFinite(options.matchWindowSeconds)
            ? options.matchWindowSeconds
            : 2;

        const formatSeconds = (value) => (
            Number.isFinite(value) ? Number(value.toFixed(3)) : null
        );

        const buildCandidates = (playheadSeconds) => {
            const candidates = [];
            for (const [videoId, entry] of monitorsById.entries()) {
                const currentTime = entry.video?.currentTime;
                if (!Number.isFinite(currentTime)) {
                    continue;
                }
                const deltaSeconds = Math.abs(currentTime - playheadSeconds);
                candidates.push({
                    videoId,
                    currentTime: formatSeconds(currentTime),
                    deltaSeconds: formatSeconds(deltaSeconds)
                });
            }
            candidates.sort((a, b) => a.deltaSeconds - b.deltaSeconds);
            return candidates;
        };

        const resolve = (playheadSeconds) => {
            const activeId = candidateSelector.getActiveId();
            if (!Number.isFinite(playheadSeconds)) {
                return {
                    id: activeId || null,
                    reason: activeId ? 'active_fallback' : 'no_active',
                    playheadSeconds: null,
                    activeId,
                    candidates: []
                };
            }
            const candidates = buildCandidates(playheadSeconds);
            if (!candidates.length) {
                return {
                    id: null,
                    reason: 'no_candidates',
                    playheadSeconds: formatSeconds(playheadSeconds),
                    activeId,
                    candidates
                };
            }
            const best = candidates[0];
            if (best.deltaSeconds <= matchWindowSeconds) {
                return {
                    id: best.videoId,
                    reason: best.videoId === activeId ? 'active_match' : 'closest_match',
                    playheadSeconds: formatSeconds(playheadSeconds),
                    activeId,
                    match: best,
                    candidates
                };
            }
            return {
                id: null,
                reason: 'no_match',
                playheadSeconds: formatSeconds(playheadSeconds),
                activeId,
                candidates
            };
        };

        return { resolve };
    };

    return { create };
})();
