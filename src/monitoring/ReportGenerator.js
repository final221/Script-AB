// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report.
 * Streamlined: Shows stream healing metrics instead of ad-blocking stats.
 */
const ReportGenerator = (() => {
    const generateContent = (metricsSummary, logs) => {
        // Header with metrics
        const header = `[STREAM HEALER METRICS]
Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Stalls Detected: ${metricsSummary.stalls_detected}
Heals Successful: ${metricsSummary.heals_successful}
Heals Failed: ${metricsSummary.heals_failed}
Heal Rate: ${metricsSummary.heal_rate}
Errors: ${metricsSummary.errors}

[LEGEND]
? = Script internal log
? = Console.log
? = Console.warn
? = Console.error

[TIMELINE - Merged script + console logs]
`;

        // Format each log entry based on source and type
        const logContent = logs.map(l => {
            const time = l.timestamp;

            if (l.source === 'CONSOLE' || l.type === 'console') {
                // Console log entry
                const icon = l.level === 'error' ? '?' : l.level === 'warn' ? '?' : '?';
                return `[${time}] ${icon} ${l.message}`;
            } else {
                // Internal script log
                const detail = l.detail ? ' | ' + JSON.stringify(l.detail) : '';
                return `[${time}] ? ${l.message}${detail}`;
            }
        }).join('\n');

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

    const downloadFile = (content) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stream_healer_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return {
        exportReport: (metricsSummary, logs) => {
            Logger.add("Generating and exporting report...");
            const content = generateContent(metricsSummary, logs);
            downloadFile(content);
        },
    };
})();
