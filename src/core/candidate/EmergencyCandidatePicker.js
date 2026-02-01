// --- EmergencyCandidatePicker ---
/**
 * Emergency candidate selection for no-heal-point scenarios.
 */
const EmergencyCandidatePicker = (() => {
    const create = (options) => {
        const monitorsById = options.monitorsById;
        const scoreVideo = options.scoreVideo;
        const getActiveId = options.getActiveId;
        const setActiveId = options.setActiveId;
        const isFallbackSource = options.isFallbackSource || (() => false);
        const logDebug = options.logDebug || (() => {});

        const isFallbackCandidate = (result) => {
            if (!result) return false;
            if (result.reasons?.includes('fallback_src')) return true;
            const src = result.vs?.currentSrc || result.vs?.src || '';
            return Boolean(src) && isFallbackSource(src);
        };

        const selectEmergencyCandidate = (reason, optionsOverride = {}) => {
            const minReadyState = Number.isFinite(optionsOverride.minReadyState)
                ? optionsOverride.minReadyState
                : CONFIG.stall.NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE;
            const requireSrc = optionsOverride.requireSrc !== undefined
                ? optionsOverride.requireSrc
                : CONFIG.stall.NO_HEAL_POINT_EMERGENCY_REQUIRE_SRC;
            const allowDead = optionsOverride.allowDead !== undefined
                ? optionsOverride.allowDead
                : Boolean(CONFIG.stall.NO_HEAL_POINT_EMERGENCY_ALLOW_DEAD);
            const label = optionsOverride.label || 'Emergency switch after no-heal point';
            let best = null;
            let bestScore = null;

            const activeCandidateId = getActiveId();
            for (const [videoId, entry] of monitorsById.entries()) {
                if (videoId === activeCandidateId) continue;
                const result = scoreVideo(entry.video, entry.monitor, videoId);
                if (isFallbackCandidate(result)) {
                    logDebug(LogEvents.tagged('CANDIDATE', 'Emergency candidate skipped (fallback source)'), {
                        videoId,
                        reason,
                        currentSrc: result.vs?.currentSrc || '',
                        score: result.score
                    });
                    continue;
                }
                if (result.deadCandidate && !allowDead) continue;
                const readyState = result.vs.readyState;
                const hasSrc = Boolean(result.vs.currentSrc || result.vs.src);
                if (readyState < minReadyState) continue;
                if (requireSrc && !hasSrc) continue;
                if (bestScore === null || result.score > bestScore) {
                    bestScore = result.score;
                    best = {
                        id: videoId,
                        entry,
                        result,
                        readyState,
                        hasSrc
                    };
                }
            }

            if (!best) return null;

            const fromId = activeCandidateId;
            setActiveId(best.id);
            Logger.add(LogEvents.tagged('CANDIDATE', label), {
                from: fromId,
                to: best.id,
                reason,
                readyState: best.readyState,
                hasSrc: best.hasSrc,
                score: bestScore
            });
            return best;
        };

        return { selectEmergencyCandidate };
    };

    return { create };
})();
