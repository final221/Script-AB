// --- DetailFormatter ---
/**
 * Formats aligned log lines and detail columns.
 */
const DetailFormatter = (() => {
    const create = (options = {}) => {
        const detailColumn = Number.isFinite(options.detailColumn)
            ? options.detailColumn
            : 40;
        const messageColumn = Number.isFinite(options.messageColumn)
            ? options.messageColumn
            : 50;

        const formatLine = (prefix, message, detail, forceDetail = false) => {
            const base = `${prefix}${message}`;
            if (!forceDetail && (detail === null || detail === undefined || detail === '')) return base;
            const padLen = Math.max(1, detailColumn - base.length);
            const detailText = detail || '';
            return base + " ".repeat(padLen) + "| " + detailText;
        };

        const formatDetailColumns = (messageText, jsonText) => {
            const normalizedMessage = messageText
                ? (messageText.length > messageColumn
                    ? messageText.slice(0, Math.max(messageColumn - 3, 0)) + '...'
                    : messageText)
                : '';

            if (jsonText) {
                const padLen = Math.max(1, messageColumn - normalizedMessage.length);
                const paddedMessage = normalizedMessage
                    ? normalizedMessage + " ".repeat(padLen)
                    : " ".repeat(messageColumn);
                return paddedMessage + "| " + jsonText;
            }

            return normalizedMessage || '';
        };

        return {
            formatLine,
            formatDetailColumns,
            detailColumn,
            messageColumn
        };
    };

    return { create };
})();
