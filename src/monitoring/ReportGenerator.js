// --- ReportGenerator ---
/**
 * Generates and facilitates the download of a comprehensive report.
 * Streamlined: Shows stream healing metrics instead of ad-blocking stats.
 */
const ReportGenerator = (() => {
    const getTimestampSuffix = () => new Date().toISOString().replace(/[:.]/g, '-');

    const generateContent = (metricsSummary, logs, healerStats) => {
        const healerLine = healerStats
            ? `Healer: isHealing ${healerStats.isHealing}, attempts ${healerStats.healAttempts}, monitors ${healerStats.monitoredCount}\n`
            : '';

        const stallCount = Number(metricsSummary.stalls_duration_count || 0);
        const stallAvgMs = Number(metricsSummary.stall_duration_avg_ms || 0);
        const stallMaxMs = Number(metricsSummary.stalls_duration_max_ms || 0);
        const stallLastMs = Number(metricsSummary.stalls_duration_last_ms || 0);
        const stallRecent = Array.isArray(metricsSummary.stall_duration_recent_ms)
            ? metricsSummary.stall_duration_recent_ms
            : [];
        const stallSummaryLine = stallCount > 0
            ? `Stall durations: count ${stallCount}, avg ${(stallAvgMs / 1000).toFixed(1)}s, max ${(stallMaxMs / 1000).toFixed(1)}s, last ${(stallLastMs / 1000).toFixed(1)}s\n`
            : 'Stall durations: none recorded\n';
        const stallRecentLine = stallRecent.length > 0
            ? `Recent stalls: ${stallRecent.slice(-5).map(ms => (Number(ms) / 1000).toFixed(1) + 's').join(', ')}\n`
            : '';

        // Header with metrics
        const versionLine = BuildInfo.getVersionLine();
        const header = `[STREAM HEALER METRICS]
${versionLine}Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Stalls Detected: ${metricsSummary.stalls_detected}
Heals Successful: ${metricsSummary.heals_successful}
Heals Failed: ${metricsSummary.heals_failed}
Heal Rate: ${metricsSummary.heal_rate}
Errors: ${metricsSummary.errors}
${stallSummaryLine}${stallRecentLine}${healerLine}
[LEGEND]
\uD83E\uDE7A = Healer core (STATE/STALL/HEAL)
\uD83C\uDFAF = Candidate selection (CANDIDATE/PROBATION/SUPPRESSION)
\uD83E\uDDED = Monitor & video (VIDEO/MONITOR/SCAN/SRC/MEDIA_STATE/EVENT)
\uD83E\uDDEA = Instrumentation & signals (INSTRUMENT/RESOURCE/CONSOLE_HINT)
\uD83E\uDDF0 = Recovery & failover (FAILOVER/BACKOFF/RESET/CATCH_UP)
\uD83E\uDDFE = Metrics & config (SYNC/CONFIG)
\u2699\uFE0F = Core/system
\uD83D\uDCCB = Console.log/info/debug
\u26A0\uFE0F = Console.warn
\u274C = Console.error
[TIMELINE - Merged script + console logs]
`;
        const formatter = LogFormatter.create();
        const logContent = formatter.formatLogs(logs);

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
            Logger.add("Generating and exporting report...");
            const content = generateContent(metricsSummary, logs, healerStats);
            downloadFile(content);
        }
    };
})();


