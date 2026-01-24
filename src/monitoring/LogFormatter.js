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
                const split = LogSanitizer.splitDetail(l.detail, { stripKeys: ['message', 'level'] });
                const detail = detailFormatter.formatDetailColumns(split.messageText, split.jsonDetail);
                return detailFormatter.formatLine(`[${time}] ${icon} `, summary, detail, true);
            }

            const prepared = LogSanitizer.prepareDetail(l.detail, l.message, seenSrcByVideo);
            const match = l.message.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (!match) {
                const detail = detailFormatter.formatDetailColumns(prepared.messageText, prepared.jsonDetail);
                return detailFormatter.formatLine(`[${time}] \uD83D\uDD27 `, l.message, detail);
            }

            const rawTag = match[1];
            const formatted = TagCategorizer.formatTag(rawTag);
            const detail = detailFormatter.formatDetailColumns(prepared.messageText, prepared.jsonDetail);
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
