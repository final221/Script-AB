// @module ExternalAssetRecoveryOps
// @depends ExternalSignalHandlerStall, ProgressModel, CandidateSelector
const ExternalAssetRecoveryOps = (() => {
    const getTiming = () => ({
        strictVerifyMs: CONFIG.stall.PROCESSING_ASSET_STRICT_VERIFY_MS || 600,
        probeWindowMs: CONFIG.stall.PROCESSING_ASSET_PROBE_WINDOW_MS || 1200,
        speculativeTimeoutMs: CONFIG.stall.PROCESSING_ASSET_SPECULATIVE_TIMEOUT_MS || 800
    });

    const sleep = (ms) => (
        Fn?.sleep ? Fn.sleep(ms) : new Promise((resolve) => setTimeout(resolve, ms))
    );

    const getActiveId = (candidateSelector) => (
        typeof candidateSelector?.getActiveId === 'function' ? candidateSelector.getActiveId() : null
    );

    const getEntry = (monitorsById, videoId) => (videoId ? monitorsById.get(videoId) : null);
    const getState = (monitorsById, videoId) => getEntry(monitorsById, videoId)?.monitor?.state || null;

    const captureCandidateBaseline = (monitorsById, videoId, actionStartMs = Date.now()) => {
        const entry = getEntry(monitorsById, videoId);
        if (!entry) return null;
        return ProgressModel.captureActionBaseline(entry.video, entry.monitor?.state, actionStartMs);
    };

    const hasCandidateProgress = (monitorsById, videoId, actionBaseline) => {
        if (!actionBaseline) return false;
        const entry = getEntry(monitorsById, videoId);
        if (!entry) return false;
        return ProgressModel.hasActionProgress(entry.video, entry.monitor?.state, actionBaseline, {
            recentWindowMs: CONFIG.stall.RECOVERY_WINDOW_MS,
            sustainedWindowMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS
        });
    };

    const getCandidateRecords = (monitorsById, candidateSelector) => {
        const records = [];
        for (const [videoId, entry] of monitorsById.entries()) {
            const score = typeof candidateSelector?.scoreVideo === 'function'
                ? candidateSelector.scoreVideo(entry.video, entry.monitor, videoId)
                : null;
            const readyState = score?.vs?.readyState ?? entry.video?.readyState ?? 0;
            const src = score?.vs?.currentSrc
                || score?.vs?.src
                || entry.video?.currentSrc
                || entry.video?.getAttribute?.('src')
                || '';
            records.push({
                id: videoId,
                score: Number.isFinite(score?.score) ? score.score : Number.NEGATIVE_INFINITY,
                readyState,
                hasSrc: Boolean(src),
                strictEligible: Boolean(src) && readyState >= 2 && !score?.deadCandidate
            });
        }
        records.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.readyState - a.readyState));
        return records;
    };

    const setActiveAndPlay = ({ processId, videoId, step, candidateSelector, monitorsById }) => {
        if (!videoId) return { switched: false, played: false };
        const entry = getEntry(monitorsById, videoId);
        if (!entry) {
            Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Candidate missing during processing asset recovery'), {
                processId,
                step,
                videoId
            });
            return { switched: false, played: false };
        }

        const fromId = getActiveId(candidateSelector);
        if (videoId !== fromId && typeof candidateSelector?.setActiveId === 'function') {
            candidateSelector.setActiveId(videoId);
        }
        const activeNow = getActiveId(candidateSelector);
        const playPromise = entry.video?.play?.();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((err) => {
                Logger.add(LogEvents.tagged('ASSET_HINT_PLAY', 'Play rejected'), {
                    processId,
                    step,
                    videoId,
                    error: err?.name,
                    message: err?.message
                });
            });
        }
        return { switched: fromId !== activeNow, played: Boolean(playPromise), fromId, toId: activeNow };
    };

    return {
        getTiming,
        sleep,
        getActiveId,
        getState,
        captureCandidateBaseline,
        hasCandidateProgress,
        getCandidateRecords,
        setActiveAndPlay
    };
})();
