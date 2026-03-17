// @module PlaybackStateAliases
// @depends PlaybackLogHelper
/**
 * Legacy playback-state aliases grouped by state section.
 */
const PlaybackStateAliases = (() => {
    const GROUPS = Object.freeze({
        status: ['state'],
        progress: [
            'lastProgressTime',
            'lastTime',
            'progressStartTime',
            'progressStreakMs',
            'progressEligible',
            'hasProgress',
            'firstSeenTime',
            'firstReadyTime',
            'initialProgressTimeoutLogged',
            'initLogEmitted'
        ],
        heal: [
            'noHealPointCount',
            'noHealPointRefreshUntil',
            'noHealPointQuietUntil',
            'nextHealAllowedTime',
            'playErrorCount',
            'nextPlayHealAllowedTime',
            'lastPlayErrorTime',
            'lastPlayBackoffLogTime',
            'lastHealPointKey',
            'healPointRepeatCount',
            'lastBackoffLogTime',
            'lastBackoffRemainingBucket',
            'lastBackoffNoHealPointCount',
            'lastHealAttemptTime',
            'lastHealDeferralLogTime',
            'healDeferSince',
            'healDeferCount',
            'lastRefreshAt',
            'lastEmergencySwitchAt'
        ],
        events: [
            'lastWatchdogLogTime',
            'lastWatchdogSnapshot',
            'lastWatchdogStallBucket',
            'lastNonActiveEventLogTime',
            'nonActiveEventCounts',
            'lastActiveEventLogTime',
            'lastActiveEventSummaryTime',
            'activeEventCounts'
        ],
        media: [
            'lastSrc',
            'lastSrcAttr',
            'lastReadyState',
            'lastNetworkState',
            'lastSrcChangeTime',
            'lastReadyStateChangeTime',
            'lastNetworkStateChangeTime',
            'lastBufferedLengthChangeTime',
            'lastBufferedLength',
            'mediaStateVerboseLogged',
            'deadCandidateSince',
            'deadCandidateUntil'
        ],
        stall: [
            'lastStallEventTime',
            'pauseFromStall',
            'stallStartTime',
            'bufferStarvedSince',
            'bufferStarved',
            'bufferStarveUntil',
            'lastBufferStarveLogTime',
            'lastBufferStarveBucket',
            'lastBufferStarveSkipLogTime',
            'lastBufferStarveRescanTime',
            'lastBufferAhead',
            'lastBufferAheadUpdateTime',
            'lastBufferAheadIncreaseTime',
            'lastSelfRecoverSkipLogTime',
            'lastAdGapSignatureLogTime',
            'lastResourceWindowLogTime'
        ],
        sync: [
            'lastSyncWallTime',
            'lastSyncMediaTime',
            'lastSyncLogTime',
            'lastSyncRate',
            'lastSyncDriftMs',
            'degradedSyncCount'
        ],
        reset: [
            'resetPendingAt',
            'resetPendingReason',
            'resetPendingType',
            'resetPendingCallback'
        ],
        catchUp: [
            'catchUpTimeoutId',
            'catchUpAttempts',
            'lastCatchUpTime'
        ]
    });

    const SPECIAL_PATHS = Object.freeze({
        state: ['status', 'value']
    });

    const buildAliasMap = () => {
        const aliasMap = {};
        Object.entries(GROUPS).forEach(([section, aliases]) => {
            aliases.forEach((alias) => {
                aliasMap[alias] = SPECIAL_PATHS[alias] || [section, alias];
            });
        });
        return aliasMap;
    };

    return {
        aliasMap: buildAliasMap()
    };
})();
