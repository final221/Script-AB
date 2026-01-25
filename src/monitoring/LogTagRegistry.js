// --- LogTagRegistry ---
/**
 * Central registry for log tag metadata (icons, groups, schemas).
 * Canonical tag strings live in LogTags.js.
 */
const LogTagRegistry = (() => {
    const ICONS = {
        healer: '\uD83E\uDE7A',
        candidate: '\uD83C\uDFAF',
        monitor: '\uD83E\uDDED',
        instrument: '\uD83E\uDDEA',
        recovery: '\uD83E\uDDF0',
        metrics: '\uD83E\uDDFE',
        core: '\u2699\uFE0F',
        other: '\uD83D\uDD27'
    };

    const GROUPS = [
        {
            id: 'healer',
            icon: ICONS.healer,
            legend: 'Healer core (STATE/STALL/HEAL)',
            includeInLegend: true,
            match: (tag) => (
                !tag.startsWith('INSTRUMENT')
                && tag !== 'CORE'
                && !tag.startsWith('CANDIDATE')
                && !tag.startsWith('PROBATION')
                && !tag.startsWith('SUPPRESSION')
                && !tag.startsWith('PROBE')
                && !tag.startsWith('FAILOVER')
                && !tag.startsWith('BACKOFF')
                && !tag.startsWith('RESET')
                && !tag.startsWith('CATCH_UP')
                && !tag.startsWith('REFRESH')
                && !tag.startsWith('DETACHED')
                && !tag.startsWith('BLOCKED')
                && !tag.startsWith('PLAY_BACKOFF')
                && !tag.startsWith('PRUNE')
                && !tag.startsWith('SYNC')
                && !tag.startsWith('CONFIG')
                && !tag.startsWith('METRIC')
                && !['VIDEO', 'MONITOR', 'SCAN', 'SCAN_ITEM', 'SRC', 'MEDIA_STATE', 'EVENT', 'EVENT_SUMMARY'].includes(tag)
            )
        },
        {
            id: 'candidate',
            icon: ICONS.candidate,
            legend: 'Candidate selection (CANDIDATE/PROBATION/SUPPRESSION)',
            includeInLegend: true,
            match: (tag) => (
                tag.startsWith('CANDIDATE')
                || tag.startsWith('PROBATION')
                || tag.startsWith('SUPPRESSION')
                || tag.startsWith('PROBE')
            )
        },
        {
            id: 'monitor',
            icon: ICONS.monitor,
            legend: 'Monitor & video (VIDEO/MONITOR/SCAN/SRC/MEDIA_STATE/EVENT)',
            includeInLegend: true,
            match: (tag) => (
                ['VIDEO', 'MONITOR', 'SCAN', 'SCAN_ITEM', 'SRC', 'MEDIA_STATE', 'EVENT', 'EVENT_SUMMARY'].includes(tag)
            )
        },
        {
            id: 'instrument',
            icon: ICONS.instrument,
            legend: 'Instrumentation & signals (INSTRUMENT/RESOURCE/CONSOLE_HINT)',
            includeInLegend: true,
            match: (tag) => tag.startsWith('INSTRUMENT')
        },
        {
            id: 'recovery',
            icon: ICONS.recovery,
            legend: 'Recovery & failover (FAILOVER/BACKOFF/RESET/CATCH_UP)',
            includeInLegend: true,
            match: (tag) => (
                tag.startsWith('FAILOVER')
                || tag.startsWith('BACKOFF')
                || tag.startsWith('RESET')
                || tag.startsWith('CATCH_UP')
                || tag.startsWith('REFRESH')
                || tag.startsWith('DETACHED')
                || tag.startsWith('BLOCKED')
                || tag.startsWith('PLAY_BACKOFF')
                || tag.startsWith('PRUNE')
            )
        },
        {
            id: 'metrics',
            icon: ICONS.metrics,
            legend: 'Metrics & config (SYNC/CONFIG)',
            includeInLegend: true,
            match: (tag) => (
                tag.startsWith('SYNC')
                || tag.startsWith('CONFIG')
                || tag.startsWith('METRIC')
            )
        },
        {
            id: 'core',
            icon: ICONS.core,
            legend: 'Core/system',
            includeInLegend: true,
            match: (tag) => tag === 'CORE'
        },
        {
            id: 'other',
            icon: ICONS.other,
            legend: 'Other',
            includeInLegend: false,
            match: () => true
        }
    ];

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

    const normalizeTag = (rawTag) => {
        if (!rawTag) {
            return { rawTag: '', tagKey: '', displayTag: '' };
        }
        if (rawTag.startsWith('HEALER:')) {
            const tag = rawTag.slice(7);
            return { rawTag, tagKey: tag, displayTag: tag };
        }
        if (rawTag.startsWith('INSTRUMENT:')) {
            const tag = rawTag.slice(11);
            const display = `INSTRUMENT:${tag}`;
            return { rawTag, tagKey: display, displayTag: display };
        }
        return { rawTag, tagKey: rawTag, displayTag: rawTag };
    };

    const getGroupForTag = (tagKey) => {
        const normalized = String(tagKey || '').toUpperCase();
        return GROUPS.find(group => group.match(normalized)) || GROUPS[GROUPS.length - 1];
    };

    const formatTag = (rawTag) => {
        const normalized = normalizeTag(rawTag);
        const group = getGroupForTag(normalized.tagKey);
        return {
            icon: group.icon,
            displayTag: normalized.displayTag,
            tagKey: normalized.tagKey,
            category: group.id
        };
    };

    const getSchema = (rawTag) => {
        if (!rawTag) return null;
        const normalized = normalizeTag(rawTag).tagKey.toUpperCase();
        return SCHEMAS[normalized] || null;
    };

    const getLegendLines = () => (
        GROUPS.filter(group => group.includeInLegend)
            .map(group => `${group.icon} = ${group.legend}`)
    );

    return {
        ICONS,
        GROUPS,
        normalizeTag,
        formatTag,
        getGroupForTag,
        getSchema,
        getLegendLines
    };
})();
