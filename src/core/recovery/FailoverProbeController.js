// --- FailoverProbeController ---
/**
 * Tracks probe attempts for failover candidates.
 */
const FailoverProbeController = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const state = {
            lastProbeTimes: new Map(),
            probeStats: new Map()
        };

        const getProbeStats = (videoId) => {
            let stats = state.probeStats.get(videoId);
            if (!stats) {
                stats = {
                    lastSummaryTime: 0,
                    counts: {
                        attempt: 0,
                        skipCooldown: 0,
                        skipNotReady: 0,
                        skipNotInDom: 0,
                        playRejected: 0
                    },
                    reasons: {},
                    lastError: null,
                    lastState: null,
                    lastReadyState: null,
                    lastHasSrc: null
                };
                state.probeStats.set(videoId, stats);
            }
            return stats;
        };

        const noteProbeReason = (stats, reason) => {
            if (!reason) return;
            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
        };

        const maybeLogProbeSummary = (videoId, stats) => {
            const now = Date.now();
            const intervalMs = CONFIG.logging.NON_ACTIVE_LOG_MS;
            if (now - stats.lastSummaryTime < intervalMs) {
                return;
            }

            const totalCount = Object.values(stats.counts).reduce((sum, value) => sum + value, 0);
            if (totalCount === 0) {
                stats.lastSummaryTime = now;
                return;
            }

            Logger.add(LogEvents.tagged('PROBE_SUMMARY', 'Probe activity'), {
                videoId,
                intervalMs,
                counts: stats.counts,
                reasons: stats.reasons,
                lastState: stats.lastState,
                lastReadyState: stats.lastReadyState,
                lastHasSrc: stats.lastHasSrc,
                lastError: stats.lastError
            });

            stats.lastSummaryTime = now;
            stats.counts = {
                attempt: 0,
                skipCooldown: 0,
                skipNotReady: 0,
                skipNotInDom: 0,
                playRejected: 0
            };
            stats.reasons = {};
            stats.lastError = null;
        };

        const probeCandidate = (videoId, reason) => {
            const entry = monitorsById.get(videoId);
            const stats = getProbeStats(videoId);
            noteProbeReason(stats, reason);
            if (!entry) return false;
            const video = entry.video;
            if (!document.contains(video)) {
                stats.counts.skipNotInDom += 1;
                maybeLogProbeSummary(videoId, stats);
                return false;
            }

            const now = Date.now();
            const cooldownMs = CONFIG.monitoring.PROBE_COOLDOWN_MS;
            const lastProbeTime = state.lastProbeTimes.get(videoId) || 0;
            if (lastProbeTime > 0 && now - lastProbeTime < cooldownMs) {
                stats.counts.skipCooldown += 1;
                maybeLogProbeSummary(videoId, stats);
                return false;
            }

            const currentSrc = video.currentSrc || (video.getAttribute ? (video.getAttribute('src') || '') : '');
            const readyState = video.readyState;
            if (!currentSrc && readyState < 2) {
                stats.counts.skipNotReady += 1;
                stats.lastReadyState = readyState;
                stats.lastHasSrc = Boolean(currentSrc);
                maybeLogProbeSummary(videoId, stats);
                return false;
            }

            state.lastProbeTimes.set(videoId, now);
            stats.counts.attempt += 1;
            stats.lastState = entry.monitor.state.state;
            stats.lastReadyState = readyState;
            stats.lastHasSrc = Boolean(currentSrc);
            maybeLogProbeSummary(videoId, stats);
            const promise = video?.play?.();
            if (promise && typeof promise.catch === 'function') {
                promise.catch((err) => {
                    const innerStats = getProbeStats(videoId);
                    noteProbeReason(innerStats, reason);
                    innerStats.counts.playRejected += 1;
                    innerStats.lastError = {
                        error: err?.name,
                        message: err?.message
                    };
                    maybeLogProbeSummary(videoId, innerStats);
                });
            }
            return true;
        };

        return { probeCandidate };
    };

    return { create };
})();
