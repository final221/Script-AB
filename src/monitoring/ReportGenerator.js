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

    const scheduleRevoke = (url) => {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const attemptAnchorDownload = (url, filename) => {
        const root = document.body || document.documentElement;
        if (!root) return { ok: false, reason: 'no_dom_root' };
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            a.style.display = 'none';
            root.appendChild(a);
            a.click();
            root.removeChild(a);
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: 'anchor_failed', error };
        }
    };

    const attemptOpenDownload = (url) => {
        try {
            const opened = window.open(url, '_blank', 'noopener');
            return { ok: Boolean(opened), reason: opened ? null : 'popup_blocked' };
        } catch (error) {
            return { ok: false, reason: 'open_failed', error };
        }
    };

    const downloadFile = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const safeName = filename || `stream_healer_logs_${getTimestampSuffix()}.txt`;

        const anchorResult = attemptAnchorDownload(url, safeName);
        if (anchorResult.ok) {
            scheduleRevoke(url);
            return true;
        }

        const openResult = attemptOpenDownload(url);
        if (openResult.ok) {
            scheduleRevoke(url);
            return true;
        }

        scheduleRevoke(url);
        Logger.add(LogEvents.tagged('ERROR', 'Report export failed'), {
            reason: anchorResult.reason || openResult.reason,
            error: anchorResult.error?.message || openResult.error?.message || null
        });
        return false;
    };

    return {
        exportReport: (metricsSummary, logs, healerStats) => {
            const content = generateContent(metricsSummary, logs, healerStats);
            downloadFile(content);
        }
    };
})();


