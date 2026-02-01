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
            lastHealAttemptTime: 0,
            lastHealDeferralLogTime: 0,
            lastRefreshAt: 0,
            lastEmergencySwitchAt: 0
        },
        events: {
            lastWatchdogLogTime: 0,
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
            lastSyncLogTime: 0
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

    const aliasMap = {
        state: ['status', 'value'],
        lastProgressTime: ['progress', 'lastProgressTime'],
        lastTime: ['progress', 'lastTime'],
        progressStartTime: ['progress', 'progressStartTime'],
        progressStreakMs: ['progress', 'progressStreakMs'],
        progressEligible: ['progress', 'progressEligible'],
        hasProgress: ['progress', 'hasProgress'],
        firstSeenTime: ['progress', 'firstSeenTime'],
        firstReadyTime: ['progress', 'firstReadyTime'],
        initialProgressTimeoutLogged: ['progress', 'initialProgressTimeoutLogged'],
        initLogEmitted: ['progress', 'initLogEmitted'],
        noHealPointCount: ['heal', 'noHealPointCount'],
        noHealPointRefreshUntil: ['heal', 'noHealPointRefreshUntil'],
        noHealPointQuietUntil: ['heal', 'noHealPointQuietUntil'],
        nextHealAllowedTime: ['heal', 'nextHealAllowedTime'],
        playErrorCount: ['heal', 'playErrorCount'],
        nextPlayHealAllowedTime: ['heal', 'nextPlayHealAllowedTime'],
        lastPlayErrorTime: ['heal', 'lastPlayErrorTime'],
        lastPlayBackoffLogTime: ['heal', 'lastPlayBackoffLogTime'],
        lastHealPointKey: ['heal', 'lastHealPointKey'],
        healPointRepeatCount: ['heal', 'healPointRepeatCount'],
        lastBackoffLogTime: ['heal', 'lastBackoffLogTime'],
        lastHealAttemptTime: ['heal', 'lastHealAttemptTime'],
        lastHealDeferralLogTime: ['heal', 'lastHealDeferralLogTime'],
        lastRefreshAt: ['heal', 'lastRefreshAt'],
        lastEmergencySwitchAt: ['heal', 'lastEmergencySwitchAt'],
        lastWatchdogLogTime: ['events', 'lastWatchdogLogTime'],
        lastNonActiveEventLogTime: ['events', 'lastNonActiveEventLogTime'],
        nonActiveEventCounts: ['events', 'nonActiveEventCounts'],
        lastActiveEventLogTime: ['events', 'lastActiveEventLogTime'],
        lastActiveEventSummaryTime: ['events', 'lastActiveEventSummaryTime'],
        activeEventCounts: ['events', 'activeEventCounts'],
        lastSrc: ['media', 'lastSrc'],
        lastSrcAttr: ['media', 'lastSrcAttr'],
        lastReadyState: ['media', 'lastReadyState'],
        lastNetworkState: ['media', 'lastNetworkState'],
        lastSrcChangeTime: ['media', 'lastSrcChangeTime'],
        lastReadyStateChangeTime: ['media', 'lastReadyStateChangeTime'],
        lastNetworkStateChangeTime: ['media', 'lastNetworkStateChangeTime'],
        lastBufferedLengthChangeTime: ['media', 'lastBufferedLengthChangeTime'],
        lastBufferedLength: ['media', 'lastBufferedLength'],
        mediaStateVerboseLogged: ['media', 'mediaStateVerboseLogged'],
        deadCandidateSince: ['media', 'deadCandidateSince'],
        deadCandidateUntil: ['media', 'deadCandidateUntil'],
        lastStallEventTime: ['stall', 'lastStallEventTime'],
        pauseFromStall: ['stall', 'pauseFromStall'],
        stallStartTime: ['stall', 'stallStartTime'],
        bufferStarvedSince: ['stall', 'bufferStarvedSince'],
        bufferStarved: ['stall', 'bufferStarved'],
        bufferStarveUntil: ['stall', 'bufferStarveUntil'],
        lastBufferStarveLogTime: ['stall', 'lastBufferStarveLogTime'],
        lastBufferStarveSkipLogTime: ['stall', 'lastBufferStarveSkipLogTime'],
        lastBufferStarveRescanTime: ['stall', 'lastBufferStarveRescanTime'],
        lastBufferAhead: ['stall', 'lastBufferAhead'],
        lastBufferAheadUpdateTime: ['stall', 'lastBufferAheadUpdateTime'],
        lastBufferAheadIncreaseTime: ['stall', 'lastBufferAheadIncreaseTime'],
        lastSelfRecoverSkipLogTime: ['stall', 'lastSelfRecoverSkipLogTime'],
        lastAdGapSignatureLogTime: ['stall', 'lastAdGapSignatureLogTime'],
        lastResourceWindowLogTime: ['stall', 'lastResourceWindowLogTime'],
        lastSyncWallTime: ['sync', 'lastSyncWallTime'],
        lastSyncMediaTime: ['sync', 'lastSyncMediaTime'],
        lastSyncLogTime: ['sync', 'lastSyncLogTime'],
        resetPendingAt: ['reset', 'resetPendingAt'],
        resetPendingReason: ['reset', 'resetPendingReason'],
        resetPendingType: ['reset', 'resetPendingType'],
        resetPendingCallback: ['reset', 'resetPendingCallback'],
        catchUpTimeoutId: ['catchUp', 'catchUpTimeoutId'],
        catchUpAttempts: ['catchUp', 'catchUpAttempts'],
        lastCatchUpTime: ['catchUp', 'lastCatchUpTime']
    };

    return {
        create,
        aliasMap
    };
})();
