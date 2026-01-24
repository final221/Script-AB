// --- NoHealPointPolicy ---
/**
 * Handles no-heal-point scenarios, refreshes, and failover decisions.
 */
const NoHealPointPolicy = (() => {
    const create = (options = {}) => {
        const backoffManager = options.backoffManager;
        const candidateSelector = options.candidateSelector;
        const monitorsById = options.monitorsById;
        const getVideoId = options.getVideoId;
        const onRescan = options.onRescan || (() => {});
        const onPersistentFailure = options.onPersistentFailure || (() => {});
        const logDebug = options.logDebug || (() => {});
        const probationPolicy = options.probationPolicy;

        const noBufferRescanTimes = new Map();

        const maybeTriggerRefresh = (videoId, monitorState, reason) => {
            if (!monitorState) return false;
            const now = Date.now();
            if ((monitorState.noHealPointCount || 0) < CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                return false;
            }
            const nextAllowed = monitorState.lastRefreshAt
                ? (monitorState.lastRefreshAt + CONFIG.stall.REFRESH_COOLDOWN_MS)
                : 0;
            if (now < nextAllowed) {
                return false;
            }
            monitorState.lastRefreshAt = now;
            logDebug(LogEvents.tagged('REFRESH', 'Refreshing video after repeated no-heal points'), {
                videoId,
                reason,
                noHealPointCount: monitorState.noHealPointCount
            });
            monitorState.noHealPointCount = 0;
            onPersistentFailure(videoId, {
                reason,
                detail: 'no_heal_point'
            });
            return true;
        };

        const handleNoHealPoint = (context, reason) => {
            const video = context.video;
            const monitorState = context.monitorState;
            const videoId = context.videoId || (getVideoId ? getVideoId(video) : 'unknown');

            backoffManager.applyBackoff(videoId, monitorState, reason);

            const ranges = MediaState.ranges(video);
            if (!ranges.length) {
                const now = Date.now();
                const lastNoBufferRescan = noBufferRescanTimes.get(videoId) || 0;
                if (now - lastNoBufferRescan >= CONFIG.stall.PROBATION_RESCAN_COOLDOWN_MS) {
                    noBufferRescanTimes.set(videoId, now);
                    if (candidateSelector) {
                        candidateSelector.activateProbation('no_buffer');
                    }
                    onRescan('no_buffer', {
                        videoId,
                        reason,
                        bufferRanges: 'none'
                    });
                }
            }

            const probationTriggered = probationPolicy?.maybeTriggerProbation
                ? probationPolicy.maybeTriggerProbation(
                    videoId,
                    monitorState,
                    reason,
                    monitorState?.noHealPointCount || 0,
                    CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS
                )
                : false;

            const stalledForMs = monitorState?.lastProgressTime
                ? (Date.now() - monitorState.lastProgressTime)
                : null;
            const shouldFailover = monitorsById && monitorsById.size > 1
                && (monitorState?.noHealPointCount >= CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS
                    || (stalledForMs !== null && stalledForMs >= CONFIG.stall.FAILOVER_AFTER_STALL_MS));

            const refreshed = maybeTriggerRefresh(videoId, monitorState, reason);

            return {
                shouldFailover,
                refreshed,
                probationTriggered
            };
        };

        return {
            handleNoHealPoint,
            maybeTriggerRefresh
        };
    };

    return { create };
})();
