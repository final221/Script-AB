// --- Metrics ---
/**
 * High-level telemetry and metrics tracking for Stream Healer.
 * Streamlined: Only tracks stream healing metrics.
 * @responsibility Collects and calculates application metrics.
 */
const Metrics = (() => {
    const STALL_HISTORY_MAX = 20;
    const counters = {
        stalls_detected: 0,
        stalls_duration_total_ms: 0,
        stalls_duration_max_ms: 0,
        stalls_duration_last_ms: 0,
        stalls_duration_count: 0,
        heals_successful: 0,
        heals_failed: 0,
        errors: 0,
        session_start: Date.now(),
    };
    const stallHistory = [];

    const increment = (category, value = 1) => {
        if (counters[category] !== undefined) {
            counters[category] += value;
        }
    };

    const getSummary = () => {
        const avgMs = counters.stalls_duration_count > 0
            ? Math.round(counters.stalls_duration_total_ms / counters.stalls_duration_count)
            : 0;

        return {
            ...counters,
            uptime_ms: Date.now() - counters.session_start,
            heal_rate: counters.stalls_detected > 0
                ? ((counters.heals_successful / counters.stalls_detected) * 100).toFixed(1) + '%'
                : 'N/A',
            stall_duration_avg_ms: avgMs,
            stall_duration_recent_ms: stallHistory.map(entry => entry.ms)
        };
    };

    const get = (category) => counters[category] || 0;

    const reset = () => {
        Object.keys(counters).forEach(key => {
            if (key !== 'session_start') counters[key] = 0;
        });
        counters.session_start = Date.now();
        stallHistory.length = 0;
    };

    return {
        increment,
        get,
        reset,
        getSummary,
        recordStallDuration: (durationMs, detail = {}) => {
            if (!Number.isFinite(durationMs) || durationMs <= 0) return;
            counters.stalls_duration_count += 1;
            counters.stalls_duration_total_ms += durationMs;
            counters.stalls_duration_last_ms = durationMs;
            counters.stalls_duration_max_ms = Math.max(counters.stalls_duration_max_ms, durationMs);

            stallHistory.push({
                ms: Math.round(durationMs),
                at: Date.now(),
                ...detail
            });
            if (stallHistory.length > STALL_HISTORY_MAX) {
                stallHistory.splice(0, stallHistory.length - STALL_HISTORY_MAX);
            }
        }
    };
})();
