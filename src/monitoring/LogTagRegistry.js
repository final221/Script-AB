// --- LogTagRegistry ---
/**
 * Central registry for log tag metadata (icons, groups, schemas).
 * Canonical tag strings live in LogTags.js.
 */
const LogTagRegistry = (() => {
    const FALLBACK_GROUP = {
        id: 'other',
        icon: '',
        legend: 'Other',
        includeInLegend: false,
        match: () => true
    };
    const GROUPS = (typeof LogTagGroups !== 'undefined' && LogTagGroups?.GROUPS)
        ? LogTagGroups.GROUPS
        : [FALLBACK_GROUP];
    const ICONS = (typeof LogTagGroups !== 'undefined' && LogTagGroups?.ICONS)
        ? LogTagGroups.ICONS
        : {};

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

    const getGroupForTag = (tagKey) => (
        typeof LogTagGroups !== 'undefined' && LogTagGroups?.getGroupForTag
            ? LogTagGroups.getGroupForTag(tagKey)
            : (GROUPS.find(group => group.match(String(tagKey || '').toUpperCase()))
                || GROUPS[GROUPS.length - 1])
    );

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
        if (typeof LogTagSchemas !== 'undefined' && LogTagSchemas?.getSchema) {
            return LogTagSchemas.getSchema(normalized);
        }
        return null;
    };

    const getLegendLines = () => (
        typeof LogTagGroups !== 'undefined' && LogTagGroups?.getLegendLines
            ? LogTagGroups.getLegendLines()
            : GROUPS.filter(group => group.includeInLegend)
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
