// --- TimelineRenderer ---
/**
 * Renders the merged log timeline for report exports.
 */
const TimelineRenderer = (() => {
    const render = (logs) => {
        const formatter = LogFormatter.create();
        const content = formatter.formatLogs(logs);
        return `[TIMELINE - Merged script + console logs]\n${content}`;
    };

    return { render };
})();
