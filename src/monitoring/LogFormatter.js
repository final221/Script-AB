// @module LogFormatter
// @depends DetailFormatter
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

        const buildRow = (l) => {
            const time = formatTime(l.timestamp);

            if (l.source === 'CONSOLE' || l.type === 'console') {
                const icon = l.level === 'error' ? '\u274C' : l.level === 'warn' ? '\u26A0\uFE0F' : '\uD83D\uDCCB';
                const summary = l.message || 'Console';
                const split = LogSanitizer.splitDetail(l.detail, { stripKeys: ['message', 'level'] });
                return {
                    prefix: `[${time}] ${icon} `,
                    summary,
                    detail: detailFormatter.formatDetailColumns(split.messageText, split.jsonDetail),
                    forceDetail: true
                };
            }

            const prepared = LogSanitizer.prepareDetail(l.detail, l.message, seenSrcByVideo);
            const match = l.message.match(/^\[([^\]]+)\]\s*(.*)$/);
            if (!match) {
                return {
                    prefix: `[${time}] \uD83D\uDD27 `,
                    summary: l.message,
                    detail: detailFormatter.formatDetailColumns(prepared.messageText, prepared.jsonDetail),
                    forceDetail: false
                };
            }

            const rawTag = match[1];
            const formatted = TagCategorizer.formatTag(rawTag);
            return {
                prefix: `[${time}] ${formatted.icon} `,
                summary: `[${formatted.displayTag}]`,
                detail: detailFormatter.formatDetailColumns(prepared.messageText, prepared.jsonDetail),
                forceDetail: false
            };
        };

        const formatLogs = (logs) => {
            const rows = logs.map(buildRow);
            const maxBaseLength = rows.reduce((max, row) => (
                Math.max(max, `${row.prefix}${row.summary}`.length)
            ), detailColumn);
            const dynamicDetailColumn = Math.max(detailColumn, maxBaseLength + 1);
            const alignedFormatter = DetailFormatter.create({
                detailColumn: dynamicDetailColumn,
                messageColumn
            });

            return rows.map((row) => (
                alignedFormatter.formatLine(row.prefix, row.summary, row.detail, row.forceDetail)
            )).join('\n');
        };

        return {
            formatLogs
        };
    };

    return {
        create
    };
})();
