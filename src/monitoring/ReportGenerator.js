// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report.
 * ENHANCED: Now includes merged timeline of script logs and console output.
 */
const ReportGenerator = (() => {
    const generateContent = (metricsSummary, logs) => {
        // Header with metrics
        const header = `[METRICS]
Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Ads Detected: ${metricsSummary.ads_detected}
Ads Blocked: ${metricsSummary.ads_blocked}
Resilience Executions: ${metricsSummary.resilience_executions}
Aggressive Recoveries: ${metricsSummary.aggressive_recoveries}
Health Triggers: ${metricsSummary.health_triggers}
Errors: ${metricsSummary.errors}

[LEGEND]
🔧 = Script internal log
📋 = Console.log
⚠️ = Console.warn
❌ = Console.error

[TIMELINE - Merged script + console logs]
`;

        // Format each log entry based on source and type
        const logContent = logs.map(l => {
            const time = l.timestamp;

            if (l.source === 'CONSOLE' || l.type === 'console') {
                // Console log entry
                const icon = l.level === 'error' ? '❌' : l.level === 'warn' ? '⚠️' : '📋';
                return `[${time}] ${icon} ${l.message}`;
            } else {
                // Internal script log
                const detail = l.detail ? ' | ' + JSON.stringify(l.detail) : '';
                return `[${time}] 🔧 ${l.message}${detail}`;
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
        a.download = `twitch_ad_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
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

