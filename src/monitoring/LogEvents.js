// --- LogEvents ---
/**
 * Central log tags and summary helpers for consistent, compact log messages.
 */
const LogEvents = (() => {
    const TAG = {
        STATE: '[HEALER:STATE]',
        WATCHDOG: '[HEALER:WATCHDOG]',
        STALL: '[HEALER:STALL]',
        READY: '[HEALER:READY]',
        PROGRESS: '[HEALER:PROGRESS]',
        BACKOFF: '[HEALER:BACKOFF]',
        PLAY_BACKOFF: '[HEALER:PLAY_BACKOFF]',
        STARVE: '[HEALER:STARVE]',
        STARVE_CLEAR: '[HEALER:STARVE_CLEAR]',
        STARVE_SKIP: '[HEALER:STARVE_SKIP]',
        SYNC: '[HEALER:SYNC]',
        RESET_CHECK: '[HEALER:RESET_CHECK]',
        RESET_SKIP: '[HEALER:RESET_SKIP]',
        RESET_PENDING: '[HEALER:RESET_PENDING]',
        RESET: '[HEALER:RESET]',
        RESET_CLEAR: '[HEALER:RESET_CLEAR]',
        DEBOUNCE: '[HEALER:DEBOUNCE]',
        STALL_SKIP: '[HEALER:STALL_SKIP]',
        EVENT: '[HEALER:EVENT]',
        EVENT_SUMMARY: '[HEALER:EVENT_SUMMARY]',
        ERROR: '[HEALER:ERROR]',
        SRC: '[HEALER:SRC]',
        MEDIA_STATE: '[HEALER:MEDIA_STATE]',
        MONITOR: '[HEALER:MONITOR]',
        VIDEO: '[HEALER:VIDEO]',
        SCAN: '[HEALER:SCAN]',
        SCAN_ITEM: '[HEALER:SCAN_ITEM]',
        BUFFER_ERROR: '[HEALER:BUFFER_ERROR]',
        REFRESH: '[HEALER:REFRESH]',
        STOP: '[HEALER:STOP]',
        SKIP: '[HEALER:SKIP]',
        NUDGE: '[HEALER:NUDGE]',
        FOUND: '[HEALER:FOUND]',
        EMERGENCY: '[HEALER:EMERGENCY]',
        NONE: '[HEALER:NONE]',
        CLEANUP: '[HEALER:CLEANUP]',
        ENDED: '[HEALER:ENDED]',
        CANDIDATE: '[HEALER:CANDIDATE]',
        CANDIDATE_DECISION: '[HEALER:CANDIDATE_DECISION]',
        CANDIDATE_SNAPSHOT: '[HEALER:CANDIDATE_SNAPSHOT]',
        PROBATION: '[HEALER:PROBATION]',
        SUPPRESSION: '[HEALER:SUPPRESSION_SUMMARY]',
        PROBE_BURST: '[HEALER:PROBE_BURST]',
        PROBE_SUMMARY: '[HEALER:PROBE_SUMMARY]',
        FAILOVER: '[HEALER:FAILOVER]',
        FAILOVER_SKIP: '[HEALER:FAILOVER_SKIP]',
        FAILOVER_PLAY: '[HEALER:FAILOVER_PLAY]',
        FAILOVER_SUCCESS: '[HEALER:FAILOVER_SUCCESS]',
        FAILOVER_REVERT: '[HEALER:FAILOVER_REVERT]',
        PRUNE: '[HEALER:PRUNE]',
        PRUNE_SKIP: '[HEALER:PRUNE_SKIP]',
        STALL_HINT: '[HEALER:STALL_HINT]',
        STALL_HINT_UNATTRIBUTED: '[HEALER:STALL_HINT_UNATTRIBUTED]',
        ASSET_HINT: '[HEALER:ASSET_HINT]',
        ASSET_HINT_SKIP: '[HEALER:ASSET_HINT_SKIP]',
        ASSET_HINT_PLAY: '[HEALER:ASSET_HINT_PLAY]',
        ADBLOCK_HINT: '[HEALER:ADBLOCK_HINT]',
        EXTERNAL: '[HEALER:EXTERNAL]',
        STALL_DETECTED: '[STALL:DETECTED]',
        STALL_DURATION: '[HEALER:STALL_DURATION]',
        HEAL_START: '[HEALER:START]',
        HEAL_FAILED: '[HEALER:FAILED]',
        HEAL_COMPLETE: '[HEALER:COMPLETE]',
        HEAL_DEFER: '[HEALER:DEFER]',
        HEAL_NO_POINT: '[HEALER:NO_HEAL_POINT]',
        HEALPOINT_STUCK: '[HEALER:HEALPOINT_STUCK]',
        CATCH_UP: '[HEALER:CATCH_UP]',
        BLOCKED: '[HEALER:BLOCKED]',
        DETACHED: '[HEALER:DETACHED]',
        SKIPPED: '[HEALER:SKIPPED]',
        SELF_RECOVER_SKIP: '[HEALER:SELF_RECOVER_SKIP]',
        STALE_RECOVERED: '[HEALER:STALE_RECOVERED]',
        STALE_GONE: '[HEALER:STALE_GONE]',
        POINT_UPDATED: '[HEALER:POINT_UPDATED]',
        RETRY: '[HEALER:RETRY]',
        RETRY_SKIP: '[HEALER:RETRY_SKIP]',
        ABORT_CONTEXT: '[HEALER:ABORT_CONTEXT]',
        SEEK: '[HEALER:SEEK]',
        SEEK_ABORT: '[HEALER:SEEK_ABORT]',
        SEEKED: '[HEALER:SEEKED]',
        SEEK_ERROR: '[HEALER:SEEK_ERROR]',
        PLAY: '[HEALER:PLAY]',
        PLAY_STUCK: '[HEALER:PLAY_STUCK]',
        PLAY_ERROR: '[HEALER:PLAY_ERROR]',
        ALREADY_PLAYING: '[HEALER:ALREADY_PLAYING]',
        SUCCESS: '[HEALER:SUCCESS]',
        GAP_OVERRIDE: '[HEALER:GAP_OVERRIDE]',
        POLL_START: '[HEALER:POLL_START]',
        POLL_SUCCESS: '[HEALER:POLL_SUCCESS]',
        POLL_TIMEOUT: '[HEALER:POLL_TIMEOUT]',
        POLLING: '[HEALER:POLLING]',
        SELF_RECOVERED: '[HEALER:SELF_RECOVERED]',
        AD_GAP: '[HEALER:AD_GAP_SIGNATURE]'
    };

    const roundNumber = (value, digits = 3) => {
        if (!Number.isFinite(value)) return value;
        if (Number.isInteger(value)) return value;
        return Number(value.toFixed(digits));
    };

    const formatValue = (value) => {
        if (value === undefined || value === null) return null;
        if (typeof value === 'number') return roundNumber(value);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string' && value.length === 0) return null;
        return value;
    };

    const formatVideoId = (value) => {
        if (typeof value !== 'string') return value;
        const match = value.match(/^video-(\d+)$/);
        if (!match) return value;
        return Number(match[1]);
    };

    const formatPairs = (pairs) => (
        pairs
            .map(([key, value]) => [key, formatValue(value)])
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => `${key}=${value}`)
            .join(' ')
    );

    const withTag = (tag, pairs) => {
        const body = formatPairs(pairs);
        return body ? `${tag} ${body}` : tag;
    };

    const getTag = (tagKey) => TAG[tagKey] || tagKey;

    const tagged = (tagKey, text) => {
        const label = getTag(tagKey);
        if (!text) return label;
        return `${label} ${text}`;
    };

    const pairs = (tagKey, pairsList) => withTag(getTag(tagKey), pairsList);

    const summary = {
        stateChange: (data = {}) => withTag(TAG.STATE, [
            ['video', formatVideoId(data.videoId)],
            ['from', data.from],
            ['to', data.to],
            ['reason', data.reason],
            ['currentTime', data.currentTime]
        ]),
        watchdogNoProgress: (data = {}) => withTag(TAG.WATCHDOG, [
            ['video', formatVideoId(data.videoId)],
            ['stalledForMs', data.stalledForMs],
            ['bufferExhausted', data.bufferExhausted],
            ['state', data.state],
            ['paused', data.paused],
            ['pauseFromStall', data.pauseFromStall],
            ['currentTime', data.currentTime],
            ['readyState', data.readyState],
            ['networkState', data.networkState],
            ['buffered', data.buffered]
        ]),
        stallDetected: (data = {}) => withTag(TAG.STALL_DETECTED, [
            ['video', formatVideoId(data.videoId)],
            ['trigger', data.trigger],
            ['stalledFor', data.stalledFor],
            ['bufferExhausted', data.bufferExhausted],
            ['paused', data.paused],
            ['pauseFromStall', data.pauseFromStall],
            ['lastProgressAgoMs', data.lastProgressAgoMs],
            ['currentTime', data.currentTime],
            ['readyState', data.readyState],
            ['networkState', data.networkState],
            ['buffered', data.buffered]
        ]),
        stallDuration: (data = {}) => withTag(TAG.STALL_DURATION, [
            ['video', formatVideoId(data.videoId)],
            ['reason', data.reason],
            ['durationMs', data.durationMs],
            ['currentTime', data.currentTime]
        ]),
        healStart: (data = {}) => withTag(TAG.HEAL_START, [
            ['attempt', data.attempt],
            ['lastProgressAgoMs', data.lastProgressAgoMs],
            ['currentTime', data.currentTime],
            ['paused', data.paused],
            ['readyState', data.readyState],
            ['networkState', data.networkState],
            ['buffered', data.buffered]
        ]),
        healFailed: (data = {}) => withTag(TAG.HEAL_FAILED, [
            ['duration', data.duration],
            ['errorName', data.errorName],
            ['error', data.error],
            ['healRange', data.healRange],
            ['gapSize', data.gapSize],
            ['isNudge', data.isNudge]
        ]),
        healComplete: (data = {}) => withTag(TAG.HEAL_COMPLETE, [
            ['duration', data.duration],
            ['healAttempts', data.healAttempts],
            ['bufferEndDelta', data.bufferEndDelta]
        ]),
        healDefer: (data = {}) => withTag(TAG.HEAL_DEFER, [
            ['bufferHeadroom', data.bufferHeadroom],
            ['minRequired', data.minRequired],
            ['healPoint', data.healPoint],
            ['buffers', data.buffers]
        ]),
        noHealPoint: (data = {}) => withTag(TAG.HEAL_NO_POINT, [
            ['duration', data.duration],
            ['currentTime', data.currentTime],
            ['bufferRanges', data.bufferRanges]
        ]),
        adGapSignature: (data = {}) => withTag(TAG.AD_GAP, [
            ['video', formatVideoId(data.videoId)],
            ['playheadSeconds', data.playheadSeconds],
            ['rangeEnd', data.rangeEnd],
            ['nextRangeStart', data.nextRangeStart],
            ['gapSize', data.gapSize],
            ['ranges', data.ranges]
        ])
    };

    return {
        TAG,
        summary,
        tagged,
        pairs,
        formatPairs,
        roundNumber
    };
})();
