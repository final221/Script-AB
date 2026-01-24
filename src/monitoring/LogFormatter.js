// --- LogFormatter ---
/**
 * Formats merged script + console logs into aligned report lines.
 */
const LogFormatter = (() => {
    const DEFAULT_DETAIL_COLUMN = 40;
    const DEFAULT_MESSAGE_COLUMN = 28;

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

    const categoryForTag = (tag) => {
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

    const formatTime = (timestamp) => {
        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) return timestamp;
        return parsed.toISOString().slice(11, 23);
    };

    const stripConsoleTimestamp = (message) => (
        message.replace(/^\s*\d{2}:\d{2}:\d{2}\s*-\s*/, '')
    );

    const splitConsoleMessage = (message) => {
        const match = message.match(/^\(([^)]+)\)\s*(.*)$/);
        if (match) {
            return {
                summary: `(${match[1]})`,
                detail: match[2] || ''
            };
        }
        return {
            summary: 'Console',
            detail: message
        };
    };

    const formatTaggedMessage = (rawTag) => {
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
        const icon = ICONS[category] || ICONS.other;
        const text = `[${displayTag}]`;
        return { icon, text };
    };

    const create = (options = {}) => {
        const detailColumn = Number.isFinite(options.detailColumn)
            ? options.detailColumn
            : DEFAULT_DETAIL_COLUMN;
        const messageColumn = Number.isFinite(options.messageColumn)
            ? options.messageColumn
            : DEFAULT_MESSAGE_COLUMN;

        const formatLine = (prefix, message, detail, forceDetail = false) => {
            const base = `${prefix}${message}`;
            if (!forceDetail && (detail === null || detail === undefined || detail === '')) return base;
            const padLen = Math.max(1, detailColumn - base.length);
            const detailText = detail || '';
            return base + " ".repeat(padLen) + "| " + detailText;
        };

        const formatDetailColumns = (messageText, jsonText) => {
            if (messageText && jsonText) {
                const padLen = Math.max(1, messageColumn - messageText.length);
                return messageText + " ".repeat(padLen) + "| " + jsonText;
            }
            return messageText || jsonText || '';
        };

        const seenSrcByVideo = new Set();

        const formatLogs = (logs) => logs.map(l => {
            const time = formatTime(l.timestamp);

            if (l.source === 'CONSOLE' || l.type === 'console') {
                const icon = l.level === 'error' ? '\u274C' : l.level === 'warn' ? '\u26A0\uFE0F' : '\uD83D\uDCCB';
                const message = stripConsoleTimestamp(l.message);
                const split = splitConsoleMessage(message);
                return formatLine(`[${time}] ${icon} `, split.summary, split.detail || '', true);
            }

            const sanitized = LogSanitizer.sanitizeDetail(l.detail, l.message, seenSrcByVideo);
            const match = l.message.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (!match) {
                const detail = sanitized && Object.keys(sanitized).length > 0
                    ? JSON.stringify(sanitized)
                    : '';
                return formatLine(`[${time}] ${ICONS.other} `, l.message, detail);
            }

            const rawTag = match[1];
            const formatted = formatTaggedMessage(rawTag);
            const messageText = (sanitized && typeof sanitized.message === 'string')
                ? sanitized.message
                : (sanitized && typeof sanitized.inlineMessage === 'string')
                    ? sanitized.inlineMessage
                    : '';
            const jsonDetail = (() => {
                if (!sanitized || typeof sanitized !== 'object') return '';
                const cloned = { ...sanitized };
                delete cloned.message;
                if (cloned.inlineMessage !== undefined) delete cloned.inlineMessage;
                return Object.keys(cloned).length > 0 ? JSON.stringify(cloned) : '';
            })();
            const detail = formatDetailColumns(messageText, jsonDetail);
            return formatLine(`[${time}] ${formatted.icon} `, formatted.text, detail);
        }).join('\n');

        return {
            formatLogs
        };
    };

    return {
        create,
        DEFAULT_DETAIL_COLUMN,
        DEFAULT_MESSAGE_COLUMN
    };
})();
