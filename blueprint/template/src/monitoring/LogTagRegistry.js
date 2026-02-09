// @module LogTagRegistry
// @depends LogTags
const LogTagRegistry = (() => {
    const GROUPS = [
        { id: 'core', legend: 'Core lifecycle and orchestration' },
        { id: 'build', legend: 'Build and verification lifecycle' },
        { id: 'other', legend: 'Unclassified tags' }
    ];

    const schemaByTag = {
        CORE: ['message', 'detail'],
        BUILD: ['message', 'detail']
    };

    const normalizeTag = (rawTag) => {
        const trimmed = String(rawTag || '').trim();
        const tagKey = trimmed.replace(/^\[|\]$/g, '');
        return { raw: trimmed, tagKey };
    };

    const getGroupForTag = (tagKey) => {
        if (tagKey === 'CORE') return GROUPS[0];
        if (tagKey === 'BUILD') return GROUPS[1];
        return GROUPS[2];
    };

    const getSchema = (rawTag) => {
        const { tagKey } = normalizeTag(rawTag);
        return schemaByTag[tagKey] || null;
    };

    return {
        GROUPS,
        normalizeTag,
        getGroupForTag,
        getSchema
    };
})();
