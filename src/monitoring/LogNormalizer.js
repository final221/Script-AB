// --- LogNormalizer ---
/**
 * Normalizes internal log messages into tag + structured detail fields.
 */
const LogNormalizer = (() => {
    const stripConsoleTimestamp = (message) => (
        message.replace(/^\s*\d{2}:\d{2}:\d{2}\s*-\s*/, '')
    );

    const normalizeConsole = (level, message) => {
        if (typeof message !== 'string') return { message, detail: null };
        const stripped = stripConsoleTimestamp(message);
        const match = stripped.match(/^\(([^)]+)\)\s*(.*)$/);
        if (match) {
            return {
                message: `(${match[1]})`,
                detail: {
                    message: match[2] || '',
                    level
                }
            };
        }
        return {
            message: 'Console',
            detail: {
                message: stripped,
                level
            }
        };
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

    return { normalizeInternal, normalizeConsole };
})();
