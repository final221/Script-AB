// --- LogNormalizer ---
/**
 * Normalizes internal log messages into tag + structured detail fields.
 */
const LogNormalizer = (() => {
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

    return { normalizeInternal };
})();
