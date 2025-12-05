// --- Logger ---
/**
 * High-level logging and telemetry export.
 * ENHANCED: Now includes console log capture for timeline correlation.
 */
const Logger = (() => {
    const logs = [];
    const consoleLogs = []; // Captured console.log/warn/error
    const MAX_LOGS = 5000;
    const MAX_CONSOLE_LOGS = 2000;

    const add = (message, detail = null) => {
        if (logs.length >= MAX_LOGS) logs.shift();
        logs.push({
            timestamp: new Date().toISOString(),
            type: 'internal',
            message,
            detail,
        });
    };

    // Capture console output with timestamp
    const captureConsole = (level, args) => {
        if (consoleLogs.length >= MAX_CONSOLE_LOGS) consoleLogs.shift();

        // Convert args to string, truncate long messages
        let message;
        try {
            message = args.map(arg => {
                if (typeof arg === 'string') return arg;
                if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                try { return JSON.stringify(arg); } catch { return String(arg); }
            }).join(' ');

            // Truncate very long messages
            if (message.length > 500) {
                message = message.substring(0, 500) + '... [truncated]';
            }
        } catch (e) {
            message = '[Unable to stringify console args]';
        }

        consoleLogs.push({
            timestamp: new Date().toISOString(),
            type: 'console',
            level, // 'log', 'warn', 'error'
            message,
        });
    };

    // Get merged timeline (our logs + console logs, sorted by timestamp)
    const getMergedTimeline = () => {
        const allLogs = [
            ...logs.map(l => ({ ...l, source: 'SCRIPT' })),
            ...consoleLogs.map(l => ({ ...l, source: 'CONSOLE' }))
        ];

        // Sort by timestamp
        allLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        return allLogs;
    };

    return {
        add,
        captureConsole,
        getLogs: () => logs,
        getConsoleLogs: () => consoleLogs,
        getMergedTimeline,
        init: () => {
            // Console interception is handled by Instrumentation module
        },
        export: () => {
            const metricsSummary = Metrics.getSummary();
            const mergedLogs = getMergedTimeline();
            ReportGenerator.exportReport(metricsSummary, mergedLogs);
        },
    };
})();

// Expose to global scope for user interaction
window.exportTwitchAdLogs = Logger.export;

