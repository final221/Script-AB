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
        const DETAIL_COLUMN = 110;
        const formatTime = (timestamp) => {
            const parsed = new Date(timestamp);
            if (Number.isNaN(parsed.getTime())) return timestamp;
            return parsed.toISOString().slice(11, 23);
        };
        const formatLine = (prefix, message, detail) => {
            const base = `${prefix}${message}`;
            if (!detail) return base;
            const padLen = Math.max(1, DETAIL_COLUMN - base.length);
            return base + " ".repeat(padLen) + "| " + detail;
        };

        const header = `[STREAM HEALER METRICS]
${versionLine}Uptime: ${(metricsSummary.uptime_ms / 1000).toFixed(1)}s
Stalls Detected: ${metricsSummary.stalls_detected}
Heals Successful: ${metricsSummary.heals_successful}
Heals Failed: ${metricsSummary.heals_failed}
Heal Rate: ${metricsSummary.heal_rate}
Errors: ${metricsSummary.errors}
${stallSummaryLine}${stallRecentLine}${healerLine}
[LEGEND]
🔧 = Script internal log
📋 = Console.log/info/debug
⚠️ = Console.warn
❌ = Console.error

[TIMELINE - Merged script + console logs]
`;

        // Format each log entry based on source and type
        const normalizeVideoToken = (value) => {
            if (typeof value !== 'string') return value;
            const match = value.match(/^video-(\d+)$/);
            if (!match) return value;
            return Number(match[1]);
        };

        const transformDetail = (input) => {
            if (Array.isArray(input)) {
                return input.map(transformDetail);
            }
            if (input && typeof input === 'object') {
                const result = {};
                Object.entries(input).forEach(([key, value]) => {
                    if (key === 'videoId') {
                        result.video = normalizeVideoToken(value);
                        return;
                    }
                    const transformed = transformDetail(value);
                    result[key] = normalizeVideoToken(transformed);
                });
                return result;
            }
            return normalizeVideoToken(input);
        };

        const stripKeys = (input, keys) => {
            if (Array.isArray(input)) {
                input.forEach(entry => stripKeys(entry, keys));
                return;
            }
            if (!input || typeof input !== 'object') return;
            Object.keys(input).forEach((key) => {
                if (keys.has(key)) {
                    delete input[key];
                } else {
                    stripKeys(input[key], keys);
                }
            });
        };

        const sanitizeDetail = (detail, message) => {
            if (!detail || typeof detail !== 'object') return detail;
            const sanitized = transformDetail(detail);
            const isVideoIntro = message.includes('[HEALER:VIDEO] Video registered');
            if (!isVideoIntro) {
                stripKeys(sanitized, new Set(['currentSrc', 'src']));
            }
            if (message.includes('[HEALER:MEDIA_STATE]') && message.includes('src attribute changed')) {
                delete sanitized.previous;
                delete sanitized.current;
                sanitized.changed = true;
            }
            if (message.includes('[HEALER:SRC]')) {
                delete sanitized.previous;
                delete sanitized.current;
                sanitized.changed = true;
            }
            return sanitized;
        };

        const logContent = logs.map(l => {
            const time = formatTime(l.timestamp);

            if (l.source === 'CONSOLE' || l.type === 'console') {
                // Console log entry
                const icon = l.level === 'error' ? '❌' : l.level === 'warn' ? '⚠️' : '📋';
                return formatLine(`[${time}] ${icon} `, l.message, null);
            } else {
                // Internal script log
                const sanitized = sanitizeDetail(l.detail, l.message);
                const detail = sanitized && Object.keys(sanitized).length > 0
                    ? JSON.stringify(sanitized)
                    : '';
                return formatLine(`[${time}] 🔧 `, l.message, detail);
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


