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
        const DETAIL_COLUMN = 40;
        const formatTime = (timestamp) => {
            const parsed = new Date(timestamp);
            if (Number.isNaN(parsed.getTime())) return timestamp;
            return parsed.toISOString().slice(11, 23);
        };
        const formatLine = (prefix, message, detail, forceDetail = false) => {
            const base = `${prefix}${message}`;
            if (!forceDetail && (detail === null || detail === undefined || detail === '')) return base;
            const padLen = Math.max(1, DETAIL_COLUMN - base.length);
            const detailText = detail || '';
            return base + " ".repeat(padLen) + "| " + detailText;
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

        const sanitizeDetail = (detail, message, seenSrcByVideo) => {
            if (!detail || typeof detail !== 'object') return detail;
            const sanitized = transformDetail(detail);
            const isVideoIntro = message.includes('[HEALER:VIDEO] Video registered');
            const isSrcChange = message.includes('[HEALER:SRC]')
                || (message.includes('[HEALER:MEDIA_STATE]') && message.includes('src attribute changed'));
            const videoKey = sanitized.video ?? sanitized.videoState?.id ?? null;
            const allowSrc = isVideoIntro
                || (isSrcChange && videoKey !== null && !seenSrcByVideo.has(videoKey));

            if (isSrcChange && videoKey !== null) {
                seenSrcByVideo.add(videoKey);
            }

            if (!allowSrc) {
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

        const ICONS = {
            healer: '\uD83E\uDE7A',
            candidate: '\uD83C\uDFAF',
            monitor: '\uD83E\uDDED',
            instrument: '\uD83E\uDDEA',
            recovery: '\uD83E\uDDF0',
            metrics: '\uD83E\uDDFE',
            core: '\u2699\uFE0F',
            other: '\uD83D\uDD27'
        };

        const categoryForTag = (tag) => {
            if (!tag) return 'other';
            const upper = tag.toUpperCase();
            if (upper.startsWith('INSTRUMENT')) return 'instrument';
            if (upper === 'CORE') return 'core';
            if (upper.startsWith('CANDIDATE')
                || upper.startsWith('PROBATION')
                || upper.startsWith('SUPPRESSION')
                || upper.startsWith('PROBE')) return 'candidate';
            if (['VIDEO', 'MONITOR', 'SCAN', 'SCAN_ITEM', 'SRC', 'MEDIA_STATE', 'EVENT', 'EVENT_SUMMARY'].includes(upper)) {
                return 'monitor';
            }
            if (upper.startsWith('FAILOVER')
                || upper.startsWith('BACKOFF')
                || upper.startsWith('RESET')
                || upper.startsWith('CATCH_UP')
                || upper.startsWith('REFRESH')
                || upper.startsWith('DETACHED')
                || upper.startsWith('BLOCKED')
                || upper.startsWith('PLAY_BACKOFF')
                || upper.startsWith('PRUNE')) {
                return 'recovery';
            }
            if (upper.startsWith('SYNC') || upper.startsWith('CONFIG') || upper.startsWith('METRIC')) return 'metrics';
            return 'healer';
        };

        const parseInlinePairs = (rest) => {
            if (!rest) return { prefix: rest, pairs: null };
            const tokens = rest.trim().split(/\s+/);
            const prefixTokens = [];
            const pairs = {};
            let inPairs = false;
            let lastKey = null;

            tokens.forEach((token) => {
                const eqIndex = token.indexOf('=');
                if (eqIndex > 0) {
                    inPairs = true;
                    const key = token.slice(0, eqIndex);
                    const value = token.slice(eqIndex + 1);
                    pairs[key] = value;
                    lastKey = key;
                    return;
                }
                if (!inPairs) {
                    prefixTokens.push(token);
                    return;
                }
                if (lastKey) {
                    pairs[lastKey] = `${pairs[lastKey]} ${token}`;
                }
            });

            if (!inPairs) {
                return { prefix: rest, pairs: null };
            }
            return {
                prefix: prefixTokens.join(' ').trim(),
                pairs
            };
        };

        const formatTaggedMessage = (rawTag) => {
            let displayTag = rawTag;
            let tagKey = rawTag;
            if (rawTag.startsWith('HEALER:')) {
                displayTag = rawTag.slice(7);
                tagKey = displayTag;
            } else if (rawTag.startsWith('INSTRUMENT:')) {
                displayTag = `INSTRUMENT:${rawTag.slice(11)}`;
                tagKey = displayTag;
            }
            const category = categoryForTag(tagKey);
            const icon = ICONS[category] || ICONS.other;
            const text = `[${displayTag}]`;
            return { icon, text };
        };


        const stripConsoleTimestamp = (message) => (
            message.replace(/^\s*\d{2}:\d{2}:\d{2}\s*-\s*/, '')
        );

        const splitConsoleMessage = (message) => {
            const match = message.match(/^\(([^)]+)\)\s*(.*)$/);
            if (match) {
                return {
                    summary: `(${match[1]})`,
                    detail: match[2] || ''
                };
            }
            return {
                summary: 'Console',
                detail: message
            };
        };

        const mergeDetail = (inlinePairs, existing) => {
            if (!inlinePairs) return existing;
            if (!existing || typeof existing !== 'object') return inlinePairs;
            return { ...inlinePairs, ...existing };
        };

        const seenSrcByVideo = new Set();

        const logContent = logs.map(l => {
            const time = formatTime(l.timestamp);

            if (l.source === 'CONSOLE' || l.type === 'console') {
                // Console log entry
                const icon = l.level === 'error' ? '\u274C' : l.level === 'warn' ? '\u26A0\uFE0F' : '\uD83D\uDCCB';
                const message = stripConsoleTimestamp(l.message);
                const split = splitConsoleMessage(message);
                const detail = split.detail || '';
                return formatLine(`[${time}] ${icon} `, split.summary, detail, true);
            } else {
                // Internal script log
                const sanitized = sanitizeDetail(l.detail, l.message, seenSrcByVideo);
                const match = l.message.match(/^\[([^\]]+)\]\s*(.*)$/);
                if (!match) {
                    const detail = sanitized && Object.keys(sanitized).length > 0
                        ? JSON.stringify(sanitized)
                        : '';
                    return formatLine(`[${time}] ${ICONS.other} `, l.message, detail);
                }
                const rawTag = match[1];
                const rest = match[2];
                const parsed = parseInlinePairs(rest);
                const mergedDetail = mergeDetail(parsed.pairs, sanitized);
                const formatted = formatTaggedMessage(rawTag);
                const detail = (() => {
                    const messageText = parsed.prefix || '';
                    const jsonDetail = mergedDetail && Object.keys(mergedDetail).length > 0
                        ? JSON.stringify(mergedDetail)
                        : '';
                    if (messageText && jsonDetail) {
                        return `${messageText} | ${jsonDetail}`;
                    }
                    return messageText || jsonDetail;
                })();
                return formatLine(`[${time}] ${formatted.icon} `, formatted.text, detail);
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


