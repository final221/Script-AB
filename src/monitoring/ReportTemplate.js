// --- ReportTemplate ---
/**
 * Shared header/legend template for report exports.
 */
const ReportTemplate = (() => {
    const buildHeader = (metricsSummary, healerStats) => {
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

        const versionLine = BuildInfo.getVersionLine();

        return `[STREAM HEALER METRICS]
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
    };

    return { buildHeader };
})();
