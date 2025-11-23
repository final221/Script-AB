// --- Logger ---
/**
 * High-level logging and telemetry export.
 * @responsibility Collects logs and exports them as a file.
 */
const Logger = (() => {
    const logs = [];
    const MAX_LOGS = 5000;

    const add = (message, detail = null) => {
        if (logs.length >= MAX_LOGS) logs.shift();
        logs.push({
            timestamp: new Date().toISOString(),
            message,
            detail,
        });
    };

    return {
        add,
        init: () => {
            // Global error and console interception are now handled by the Instrumentation module.
            // This Logger.init is intentionally left empty.
        },
        export: () => {
            const metricsSummary = Metrics.getSummary();
            const rawLogs = logs; // Access the private logs array
            ReportGenerator.exportReport(metricsSummary, rawLogs);
        },
    };
})();

// Expose to global scope for user interaction
window.exportTwitchAdLogs = Logger.export;
