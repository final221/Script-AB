// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report.
 * Streamlined: Shows stream healing metrics instead of ad-blocking stats.
 */
const ReportGenerator = (() => {
    const getTimestampSuffix = () => new Date().toISOString().replace(/[:.]/g, '-');

    const generateContent = (metricsSummary, logs, healerStats) => {
        const header = ReportTemplate.buildHeader(metricsSummary, healerStats);
        const logContent = TimelineRenderer.render(logs);

        // Stats about what was captured
        const scriptLogs = logs.filter(l => l.source === 'SCRIPT' || l.type === 'internal').length;
        const consoleLogs = logs.filter(l => l.source === 'CONSOLE' || l.type === 'console').length;

        const footer = `

[CAPTURE STATS]
Script logs: ${scriptLogs}
Console logs: ${consoleLogs}
Total entries: ${logs.length}
`;

        return header + logContent + footer;
    };

    const downloadFile = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `stream_healer_logs_${getTimestampSuffix()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return {
        exportReport: (metricsSummary, logs, healerStats) => {
            const content = generateContent(metricsSummary, logs, healerStats);
            downloadFile(content);
        }
    };
})();


