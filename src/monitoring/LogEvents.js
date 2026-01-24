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
        SYNC: '[HEALER:SYNC]',
        RESET_CHECK: '[HEALER:RESET_CHECK]',
        RESET_SKIP: '[HEALER:RESET_SKIP]',
        RESET_PENDING: '[HEALER:RESET_PENDING]',
        RESET: '[HEALER:RESET]',
        RESET_CLEAR: '[HEALER:RESET_CLEAR]',
        EVENT: '[HEALER:EVENT]',
        EVENT_SUMMARY: '[HEALER:EVENT_SUMMARY]',
        SRC: '[HEALER:SRC]',
        MEDIA_STATE: '[HEALER:MEDIA_STATE]',
        MONITOR: '[HEALER:MONITOR]',
        VIDEO: '[HEALER:VIDEO]',
        SCAN: '[HEALER:SCAN]',
        SCAN_ITEM: '[HEALER:SCAN_ITEM]',
        REFRESH: '[HEALER:REFRESH]',
        STOP: '[HEALER:STOP]',
        SKIP: '[HEALER:SKIP]',
        CLEANUP: '[HEALER:CLEANUP]',
        ENDED: '[HEALER:ENDED]',
        STALL_DETECTED: '[STALL:DETECTED]',
        STALL_DURATION: '[HEALER:STALL_DURATION]',
        HEAL_START: '[HEALER:START]',
        HEAL_FAILED: '[HEALER:FAILED]',
        HEAL_COMPLETE: '[HEALER:COMPLETE]',
        HEAL_DEFER: '[HEALER:DEFER]',
        HEAL_NO_POINT: '[HEALER:NO_HEAL_POINT]',
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
