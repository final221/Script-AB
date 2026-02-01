// --- LogNormalizer ---
/**
 * Normalizes internal log messages into tag + structured detail fields.
 */
const LogNormalizer = (() => {
    const stripConsoleTimestamp = (message) => (
        message.replace(/^\s*\d{2}:\d{2}:\d{2}\s*-\s*/, '')
    );

    const createEvent = ({ timestamp, type, level, message, detail }) => ({
        timestamp,
        type,
        level,
        message,
        detail,
        tag: (typeof LogSanitizer !== 'undefined' && LogSanitizer?.getRawTag)
            ? LogSanitizer.getRawTag(message)
            : null
    });

    const normalizeConsole = (level, message) => {
        if (typeof message !== 'string') return { message, detail: null };
        const stripped = stripConsoleTimestamp(message);
        const match = stripped.match(/^\(([^)]+)\)\s*(.*)$/);
        if (match) {
            return {
                message: `(${match[1]})`,
                detail: {
                    message: match[2] || '',
                    level,
                    fullMessage: level === 'error' ? (match[2] || '') : undefined
                }
            };
        }
        return {
            message: 'Console',
            detail: {
                message: stripped,
                level,
                fullMessage: level === 'error' ? stripped : undefined
            }
        };
    };

    const buildConsoleEvent = (level, message, timestamp) => {
        const normalized = normalizeConsole(level, message);
        return createEvent({
            timestamp: timestamp || new Date().toISOString(),
            type: 'console',
            level,
            message: normalized.message,
            detail: normalized.detail
        });
    };

    const normalizeInternal = (message, detail) => {
        if (!message || typeof message !== 'string') return { message, detail };
        const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (!match) return { message, detail };

        const rawTag = match[1];
        const rest = match[2] || '';
        if (!rest) return { message: `[${rawTag}]`, detail };

        const parsed = LogSanitizer.parseInlinePairs(rest);
        let nextDetail = LogSanitizer.mergeDetail(parsed.pairs, detail);

        if (parsed.prefix) {
            if (nextDetail && typeof nextDetail === 'object') {
                if (nextDetail.message === undefined) {
                    nextDetail.message = parsed.prefix;
                } else if (nextDetail.inlineMessage === undefined) {
                    nextDetail.inlineMessage = parsed.prefix;
                }
            } else {
                nextDetail = { message: parsed.prefix };
            }
        }

        return {
            message: `[${rawTag}]`,
            detail: nextDetail
        };
    };

    const buildInternalEvent = (message, detail, timestamp) => {
        const normalized = normalizeInternal(message, detail);
        return createEvent({
            timestamp: timestamp || new Date().toISOString(),
            type: 'internal',
            message: normalized.message,
            detail: normalized.detail
        });
    };

    return {
        normalizeInternal,
        normalizeConsole,
        buildInternalEvent,
        buildConsoleEvent,
        createEvent
    };
})();
