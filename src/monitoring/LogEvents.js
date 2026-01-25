// --- LogEvents ---
/**
 * Central log tags and summary helpers for consistent, compact log messages.
 */
const LogEvents = (() => {
    const TAG = (typeof LogTags !== 'undefined' && LogTags.TAG)
        ? LogTags.TAG
        : {};

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

    const getTag = (tagKey) => TAG[tagKey] || tagKey;

    const event = (tagKey, options = {}) => {
        const label = getTag(tagKey);
        const detail = (options.detail && typeof options.detail === 'object')
            ? { ...options.detail }
            : {};
        const summary = options.summary || options.message || options.text || '';

        if (Array.isArray(options.pairs)) {
            options.pairs.forEach(([key, value]) => {
                const nextValue = formatValue(value);
                if (nextValue === null || nextValue === undefined) return;
                detail[key] = nextValue;
            });
        }

        if (summary) {
            if (detail.message === undefined) {
                detail.message = summary;
            } else if (detail.inlineMessage === undefined) {
                detail.inlineMessage = summary;
            }
        }

        return {
            message: label,
            detail: Object.keys(detail).length > 0 ? detail : null
        };
    };

    const tagged = (tagKey, text, detail) => event(tagKey, { summary: text, detail });
    const pairs = (tagKey, pairsList, detail) => event(tagKey, { pairs: pairsList, detail });

    const summary = {
        stateChange: (data = {}) => pairs('STATE', [
            ['video', formatVideoId(data.videoId)],
            ['from', data.from],
            ['to', data.to],
            ['reason', data.reason],
            ['currentTime', data.currentTime]
        ]),
        watchdogNoProgress: (data = {}) => pairs('WATCHDOG', [
            ['video', formatVideoId(data.videoId)],
            ['stalledForMs', data.stalledForMs],
            ['bufferExhausted', data.bufferExhausted],
            ['state', data.state],
            ['paused', data.paused],
            ['pauseFromStall', data.pauseFromStall]
        ]),
        stallDetected: (data = {}) => pairs('STALL_DETECTED', [
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
        stallDuration: (data = {}) => pairs('STALL_DURATION', [
            ['video', formatVideoId(data.videoId)],
            ['reason', data.reason],
            ['durationMs', data.durationMs],
            ['currentTime', data.currentTime]
        ]),
        healStart: (data = {}) => pairs('HEAL_START', [
            ['attempt', data.attempt],
            ['lastProgressAgoMs', data.lastProgressAgoMs],
            ['currentTime', data.currentTime],
            ['paused', data.paused],
            ['readyState', data.readyState],
            ['networkState', data.networkState],
            ['buffered', data.buffered]
        ]),
        healFailed: (data = {}) => pairs('HEAL_FAILED', [
            ['duration', data.duration],
            ['errorName', data.errorName],
            ['error', data.error],
            ['healRange', data.healRange],
            ['gapSize', data.gapSize],
            ['isNudge', data.isNudge]
        ]),
        healComplete: (data = {}) => pairs('HEAL_COMPLETE', [
            ['duration', data.duration],
            ['healAttempts', data.healAttempts],
            ['bufferEndDelta', data.bufferEndDelta]
        ]),
        healDefer: (data = {}) => pairs('HEAL_DEFER', [
            ['bufferHeadroom', data.bufferHeadroom],
            ['minRequired', data.minRequired],
            ['healPoint', data.healPoint],
            ['buffers', data.buffers]
        ]),
        noHealPoint: (data = {}) => pairs('HEAL_NO_POINT', [
            ['duration', data.duration],
            ['currentTime', data.currentTime],
            ['bufferRanges', data.bufferRanges]
        ]),
        adGapSignature: (data = {}) => pairs('AD_GAP', [
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
        event,
        roundNumber
    };
})();
