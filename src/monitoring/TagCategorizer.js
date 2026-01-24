// --- TagCategorizer ---
/**
 * Central mapping of log tags to categories and icons.
 */
const TagCategorizer = (() => {
    const FALLBACK_ICONS = {
        healer: '\uD83E\uDE7A',
        candidate: '\uD83C\uDFAF',
        monitor: '\uD83E\uDDED',
        instrument: '\uD83E\uDDEA',
        recovery: '\uD83E\uDDF0',
        metrics: '\uD83E\uDDFE',
        core: '\u2699\uFE0F',
        other: '\uD83D\uDD27'
    };

    const getRegistry = () => (
        typeof LogTagRegistry !== 'undefined' ? LogTagRegistry : null
    );

    const categoryForTag = (tag) => {
        const registry = getRegistry();
        if (registry?.getGroupForTag) {
            return registry.getGroupForTag(tag).id;
        }
        if (!tag) return 'other';
        const upper = tag.toUpperCase();
        if (upper.startsWith('INSTRUMENT')) return 'instrument';
        if (upper === 'CORE') return 'core';
        if (upper.startsWith('CANDIDATE')
            || upper.startsWith('PROBATION')
            || upper.startsWith('SUPPRESSION')
            || upper.startsWith('PROBE')) return 'candidate';
        if (['VIDEO', 'MONITOR', 'SCAN', 'SCAN_ITEM', 'SRC', 'MEDIA_STATE', 'EVENT', 'EVENT_SUMMARY'].includes(upper)) {
            return 'monitor';
        }
        if (upper.startsWith('FAILOVER')
            || upper.startsWith('BACKOFF')
            || upper.startsWith('RESET')
            || upper.startsWith('CATCH_UP')
            || upper.startsWith('REFRESH')
            || upper.startsWith('DETACHED')
            || upper.startsWith('BLOCKED')
            || upper.startsWith('PLAY_BACKOFF')
            || upper.startsWith('PRUNE')) {
            return 'recovery';
        }
        if (upper.startsWith('SYNC') || upper.startsWith('CONFIG') || upper.startsWith('METRIC')) return 'metrics';
        return 'healer';
    };

    const formatTag = (rawTag) => {
        const registry = getRegistry();
        if (registry?.formatTag) return registry.formatTag(rawTag);
        let displayTag = rawTag;
        let tagKey = rawTag;
        if (rawTag.startsWith('HEALER:')) {
            displayTag = rawTag.slice(7);
            tagKey = displayTag;
        } else if (rawTag.startsWith('INSTRUMENT:')) {
            displayTag = `INSTRUMENT:${rawTag.slice(11)}`;
            tagKey = displayTag;
        }
        const category = categoryForTag(tagKey);
        const icon = (FALLBACK_ICONS[category] || FALLBACK_ICONS.other);
        return {
            icon,
            displayTag,
            tagKey,
            category
        };
    };

    const ICONS = (() => {
        const registry = getRegistry();
        return registry?.ICONS || FALLBACK_ICONS;
    })();

    return {
        ICONS,
        categoryForTag,
        formatTag
    };
})();
