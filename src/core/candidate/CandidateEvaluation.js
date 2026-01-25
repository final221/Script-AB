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

        for (const [videoId, entry] of monitorsById.entries()) {
            const result = scoreVideo(entry.video, entry.monitor, videoId);
            const trustInfo = CandidateTrust.getTrustInfo(result);
            const trusted = trustInfo.trusted;
            const scoreRecord = CandidateScoreRecord.buildScoreRecord(videoId, entry, result, trustInfo);
            const candidate = CandidateScoreRecord.buildCandidate(videoId, entry, result, trustInfo);
            scores.push(scoreRecord);

            if (videoId === activeCandidateId) {
                current = candidate;
            }

            if (!best || result.score > best.score) {
                best = candidate;
            }
            if (!result.deadCandidate && (!bestNonDead || result.score > bestNonDead.score)) {
                bestNonDead = candidate;
            }
            if (trusted && (!bestTrusted || result.score > bestTrusted.score)) {
                bestTrusted = candidate;
            }
            if (trusted && !result.deadCandidate
                && (!bestTrustedNonDead || result.score > bestTrustedNonDead.score)) {
                bestTrustedNonDead = candidate;
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
