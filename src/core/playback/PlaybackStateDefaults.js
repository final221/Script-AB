// @module PlaybackStateDefaults
// @depends PlaybackLogHelper, PlaybackStateAliases
// --- PlaybackStateDefaults ---
/**
 * Provides initial playback state structure and alias map.
 */
const MonitorStates = (() => Object.freeze({
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    STALLED: 'STALLED',
    HEALING: 'HEALING',
    RESET: 'RESET',
    ERROR: 'ERROR',
    ENDED: 'ENDED'
}))();

const PlaybackStateDefaults = (() => {
    const create = (video) => ({
        status: {
            value: MonitorStates.PLAYING
        },
        progress: {
            lastProgressTime: 0,
            lastTime: video.currentTime,
            progressStartTime: null,
            progressStreakMs: 0,
            progressEligible: false,
            hasProgress: false,
            firstSeenTime: Date.now(),
            firstReadyTime: 0,
            initialProgressTimeoutLogged: false,
            initLogEmitted: false
        },
        heal: {
            noHealPointCount: 0,
            noHealPointRefreshUntil: 0,
            noHealPointQuietUntil: 0,
            nextHealAllowedTime: 0,
            playErrorCount: 0,
            nextPlayHealAllowedTime: 0,
            lastPlayErrorTime: 0,
            lastPlayBackoffLogTime: 0,
            lastHealPointKey: null,
            healPointRepeatCount: 0,
            lastBackoffLogTime: 0,
            lastBackoffRemainingBucket: 0,
            lastBackoffNoHealPointCount: 0,
            lastHealAttemptTime: 0,
            lastHealDeferralLogTime: 0,
            healDeferSince: 0,
            healDeferCount: 0,
            lastRefreshAt: 0,
            lastEmergencySwitchAt: 0
        },
        events: {
            lastWatchdogLogTime: 0,
            lastWatchdogSnapshot: '',
            lastWatchdogStallBucket: 0,
            lastNonActiveEventLogTime: 0,
            nonActiveEventCounts: {},
            lastActiveEventLogTime: 0,
            lastActiveEventSummaryTime: 0,
            activeEventCounts: {}
        },
        media: {
            lastSrc: video.currentSrc || video.getAttribute('src') || '',
            lastSrcAttr: video.getAttribute ? (video.getAttribute('src') || '') : '',
            lastReadyState: video.readyState,
            lastNetworkState: video.networkState,
            lastSrcChangeTime: 0,
            lastReadyStateChangeTime: 0,
            lastNetworkStateChangeTime: 0,
            lastBufferedLengthChangeTime: 0,
            lastBufferedLength: (() => {
                try {
                    return video.buffered ? video.buffered.length : 0;
                } catch (error) {
                    return 0;
                }
            })(),
            mediaStateVerboseLogged: false,
            deadCandidateSince: 0,
            deadCandidateUntil: 0
        },
        stall: {
            lastStallEventTime: 0,
            pauseFromStall: false,
            stallStartTime: 0,
            bufferStarvedSince: 0,
            bufferStarved: false,
            bufferStarveUntil: 0,
            lastBufferStarveLogTime: 0,
            lastBufferStarveBucket: 0,
            lastBufferStarveSkipLogTime: 0,
            lastBufferStarveRescanTime: 0,
            lastBufferAhead: null,
            lastBufferAheadUpdateTime: 0,
            lastBufferAheadIncreaseTime: 0,
            lastSelfRecoverSkipLogTime: 0,
            lastAdGapSignatureLogTime: 0,
            lastResourceWindowLogTime: 0
        },
        sync: {
            lastSyncWallTime: 0,
            lastSyncMediaTime: 0,
            lastSyncLogTime: 0,
            lastSyncRate: null,
            lastSyncDriftMs: 0,
            degradedSyncCount: 0
        },
        reset: {
            resetPendingAt: 0,
            resetPendingReason: null,
            resetPendingType: null,
            resetPendingCallback: null
        },
        catchUp: {
            catchUpTimeoutId: null,
            catchUpAttempts: 0,
            lastCatchUpTime: 0
        }
    });

    return {
        create,
        aliasMap: PlaybackStateAliases.aliasMap
    };
})();
