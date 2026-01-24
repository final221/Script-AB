// --- CandidateEvaluation ---
/**
 * Aggregates candidate score snapshots for selection decisions.
 */
const CandidateEvaluation = (() => {
    const evaluate = (options = {}) => {
        const monitorsById = options.monitorsById;
        const activeCandidateId = options.activeCandidateId;
        const scoreVideo = options.scoreVideo;

        let best = null;
        let bestNonDead = null;
        let bestTrusted = null;
        let bestTrustedNonDead = null;
        let current = null;
        const scores = [];

        if (activeCandidateId && monitorsById.has(activeCandidateId)) {
            const entry = monitorsById.get(activeCandidateId);
            const result = scoreVideo(entry.video, entry.monitor, activeCandidateId);
            const trustInfo = CandidateTrust.getTrustInfo(result);
            current = CandidateScoreRecord.buildCandidate(activeCandidateId, entry, result, trustInfo);
        }

        for (const [videoId, entry] of monitorsById.entries()) {
            const result = scoreVideo(entry.video, entry.monitor, videoId);
            const trustInfo = CandidateTrust.getTrustInfo(result);
            const trusted = trustInfo.trusted;
            scores.push(CandidateScoreRecord.buildScoreRecord(videoId, entry, result, trustInfo));

            if (!best || result.score > best.score) {
                best = CandidateScoreRecord.buildCandidate(videoId, entry, result, trustInfo);
            }
            if (!result.deadCandidate && (!bestNonDead || result.score > bestNonDead.score)) {
                bestNonDead = CandidateScoreRecord.buildCandidate(videoId, entry, result, trustInfo);
            }
            if (trusted && (!bestTrusted || result.score > bestTrusted.score)) {
                bestTrusted = CandidateScoreRecord.buildCandidate(videoId, entry, result, trustInfo);
            }
            if (trusted && !result.deadCandidate
                && (!bestTrustedNonDead || result.score > bestTrustedNonDead.score)) {
                bestTrustedNonDead = CandidateScoreRecord.buildCandidate(videoId, entry, result, trustInfo);
            }
        }

        return {
            scores,
            current,
            best,
            bestNonDead,
            bestTrusted,
            bestTrustedNonDead
        };
    };

    return { evaluate };
})();
