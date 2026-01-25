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

        const maybeTriggerEmergencySwitch = (videoId, monitorState, reason, options = {}) => {
            if (!candidateSelector || typeof candidateSelector.selectEmergencyCandidate !== 'function') {
                return false;
            }
            if (!CONFIG.stall.NO_HEAL_POINT_EMERGENCY_SWITCH) {
                return false;
            }
            if (!monitorState) return false;
            if ((monitorState.noHealPointCount || 0) < CONFIG.stall.NO_HEAL_POINT_EMERGENCY_AFTER) {
                return false;
            }
            const now = Date.now();
            const lastSwitch = monitorState.lastEmergencySwitchAt || 0;
            if (now - lastSwitch < CONFIG.stall.NO_HEAL_POINT_EMERGENCY_COOLDOWN_MS) {
                return false;
            }
            const switched = candidateSelector.selectEmergencyCandidate(reason, options);
            if (switched) {
                monitorState.lastEmergencySwitchAt = now;
                return true;
            }
            return false;
        };

        const maybeTriggerLastResortSwitch = (videoId, monitorState, reason) => {
            if (!CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_SWITCH) {
                return false;
            }
            if (!monitorState) return false;
            if ((monitorState.noHealPointCount || 0) < CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                return false;
            }
            if (!monitorsById || monitorsById.size < 2) {
                return false;
            }
            return maybeTriggerEmergencySwitch(videoId, monitorState, `${reason}_last_resort`, {
                minReadyState: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_MIN_READY_STATE,
                requireSrc: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC,
                allowDead: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD
            });
        };

        const maybeTriggerRefresh = (videoId, monitorState, reason) => {
            if (!monitorState) return false;
            const now = Date.now();
            if ((monitorState.noHealPointCount || 0) < CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                return false;
            }
            if (monitorState.noHealPointRefreshUntil && now < monitorState.noHealPointRefreshUntil) {
                return false;
            }
            const nextAllowed = monitorState.lastRefreshAt
                ? (monitorState.lastRefreshAt + CONFIG.stall.REFRESH_COOLDOWN_MS)
                : 0;
            if (now < nextAllowed) {
                return false;
            }
            monitorState.lastRefreshAt = now;
            monitorState.noHealPointRefreshUntil = 0;
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

            if (monitorState && (monitorState.noHealPointCount || 0) >= CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS) {
                const now = Date.now();
                const ranges = MediaState.ranges(video);
                if (ranges.length) {
                    const end = ranges[ranges.length - 1].end;
                    const headroom = Math.max(0, end - video.currentTime);
                    const hasSrc = Boolean(video.currentSrc || video.getAttribute?.('src'));
                    const readyState = video.readyState;
                    if (headroom < CONFIG.recovery.MIN_HEAL_HEADROOM_S
                        && hasSrc
                        && readyState >= CONFIG.stall.NO_HEAL_POINT_REFRESH_MIN_READY_STATE) {
                        if (!monitorState.noHealPointRefreshUntil) {
                            monitorState.noHealPointRefreshUntil = now + CONFIG.stall.NO_HEAL_POINT_REFRESH_DELAY_MS;
                        }
                    }
                }
            }

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

            const emergencySwitched = maybeTriggerEmergencySwitch(videoId, monitorState, reason);
            const lastResortSwitched = !emergencySwitched
                ? maybeTriggerLastResortSwitch(videoId, monitorState, reason)
                : false;
            const refreshed = !emergencySwitched && !lastResortSwitched
                ? maybeTriggerRefresh(videoId, monitorState, reason)
                : false;

            return {
                shouldFailover,
                refreshed,
                probationTriggered,
                emergencySwitched: emergencySwitched || lastResortSwitched
            };
        };

        return {
            handleNoHealPoint,
            maybeTriggerRefresh
        };
    };

    return { create };
})();
