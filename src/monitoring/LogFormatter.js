// --- LogFormatter ---
/**
 * Formats merged script + console logs into aligned report lines.
 */
const LogFormatter = (() => {
    const formatTime = (timestamp) => {
        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) return timestamp;
        return parsed.toISOString().slice(11, 23);
    };

    const create = (options = {}) => {
        const detailColumn = Number.isFinite(options.detailColumn)
            ? options.detailColumn
            : (CONFIG?.logging?.REPORT_DETAIL_COLUMN ?? DetailFormatter.create().detailColumn);
        const messageColumn = Number.isFinite(options.messageColumn)
            ? options.messageColumn
            : (CONFIG?.logging?.REPORT_MESSAGE_COLUMN ?? DetailFormatter.create().messageColumn);

        const detailFormatter = DetailFormatter.create({
            detailColumn,
            messageColumn
        });

        const seenSrcByVideo = new Set();

        const formatLogs = (logs) => logs.map(l => {
            const time = formatTime(l.timestamp);

            if (l.source === 'CONSOLE' || l.type === 'console') {
                const icon = l.level === 'error' ? '\u274C' : l.level === 'warn' ? '\u26A0\uFE0F' : '\uD83D\uDCCB';
                const summary = l.message || 'Console';
                const detailMessage = l.detail?.message || '';
                const jsonDetail = (() => {
                    if (!l.detail || typeof l.detail !== 'object') return '';
                    const cloned = { ...l.detail };
                    delete cloned.message;
                    if (cloned.level !== undefined) delete cloned.level;
                    return Object.keys(cloned).length > 0 ? JSON.stringify(cloned) : '';
                })();
                const detail = detailFormatter.formatDetailColumns(detailMessage, jsonDetail);
                return detailFormatter.formatLine(`[${time}] ${icon} `, summary, detail, true);
            }

            const sanitized = LogSanitizer.sanitizeDetail(l.detail, l.message, seenSrcByVideo);
            const match = l.message.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (!match) {
                const detail = sanitized && Object.keys(sanitized).length > 0
                    ? JSON.stringify(sanitized)
                    : '';
                return detailFormatter.formatLine(`[${time}] \uD83D\uDD27 `, l.message, detail);
            }

            const rawTag = match[1];
            const formatted = TagCategorizer.formatTag(rawTag);
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
            const detail = detailFormatter.formatDetailColumns(messageText, jsonDetail);
            return detailFormatter.formatLine(`[${time}] ${formatted.icon} `, `[${formatted.displayTag}]`, detail);
        }).join('\n');

        return {
            formatLogs
        };
    };

    return {
        create
    };
})();
