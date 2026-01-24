// --- LogSchemas ---
/**
 * Optional key ordering hints for log detail payloads.
 */
const LogSchemas = (() => {
    const SCHEMAS = {
        STATE: [
            'message',
            'video',
            'from',
            'to',
            'reason',
            'currentTime',
            'paused',
            'readyState',
            'networkState',
            'buffered',
            'lastProgressAgoMs',
            'progressStreakMs',
            'progressEligible',
            'pauseFromStall'
        ],
        WATCHDOG: [
            'message',
            'video',
            'stalledForMs',
            'bufferExhausted',
            'state',
            'paused',
            'pauseFromStall',
            'currentTime',
            'readyState',
            'networkState',
            'buffered'
        ],
        STALL_DURATION: [
            'message',
            'video',
            'reason',
            'durationMs',
            'currentTime',
            'bufferAhead',
            'readyState',
            'networkState'
        ],
        PROGRESS: [
            'message',
            'video',
            'reason',
            'currentTime',
            'progressStreakMs',
            'minProgressMs'
        ],
        READY: [
            'message',
            'video',
            'reason',
            'readyState'
        ],
        MEDIA_STATE: [
            'message',
            'video',
            'changed',
            'previous',
            'current',
            'videoState'
        ],
        SRC: [
            'message',
            'video',
            'changed',
            'previous',
            'current',
            'videoState'
        ],
        EVENT: [
            'message',
            'video',
            'state'
        ],
        EVENT_SUMMARY: [
            'message',
            'video',
            'events',
            'sinceMs',
            'state'
        ],
        BACKOFF: [
            'message',
            'video',
            'reason',
            'noHealPointCount',
            'backoffMs',
            'nextHealAllowedInMs'
        ],
        PLAY_BACKOFF: [
            'message',
            'video',
            'reason',
            'errorName',
            'error',
            'playErrorCount',
            'backoffMs',
            'nextHealAllowedInMs'
        ],
        FAILOVER: [
            'message',
            'from',
            'to',
            'reason',
            'stalledForMs'
        ]
    };

    const getSchema = (rawTag) => {
        if (!rawTag) return null;
        const normalized = rawTag.startsWith('HEALER:') ? rawTag.slice(7) : rawTag;
        return SCHEMAS[normalized] || null;
    };

    return { getSchema };
})();
