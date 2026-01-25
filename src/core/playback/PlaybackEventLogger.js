// --- PlaybackEventLogger ---
/**
 * Shared logging for playback event handlers.
 */
const PlaybackEventLogger = (() => {
    const create = (options = {}) => {
        const logDebug = options.logDebug || (() => {});
        const state = options.state;
        const isActive = options.isActive || (() => true);

        const ALWAYS_LOG_EVENTS = new Set(['abort', 'emptied', 'error', 'ended']);

        const logEvent = (event, detailFactory = null) => {
            if (!CONFIG.debug) return;
            const now = Date.now();
            const detail = typeof detailFactory === 'function'
                ? detailFactory()
                : (detailFactory || {});

            if (ALWAYS_LOG_EVENTS.has(event)) {
                logDebug(LogEvents.tagged('EVENT', event), detail);
                return;
            }

            if (isActive()) {
                const counts = state.activeEventCounts || {};
                counts[event] = (counts[event] || 0) + 1;
                state.activeEventCounts = counts;

                const lastActive = state.lastActiveEventLogTime || 0;
                if (now - lastActive >= CONFIG.logging.ACTIVE_EVENT_LOG_MS) {
                    state.lastActiveEventLogTime = now;
                    logDebug(LogEvents.tagged('EVENT', event), detail);
                }

                const lastSummary = state.lastActiveEventSummaryTime || 0;
                if (now - lastSummary >= CONFIG.logging.ACTIVE_EVENT_SUMMARY_MS) {
                    state.lastActiveEventSummaryTime = now;
                    const summary = { ...counts };
                    state.activeEventCounts = {};
                    logDebug(LogEvents.tagged('EVENT_SUMMARY', 'Active'), {
                        events: summary,
                        sinceMs: lastSummary ? (now - lastSummary) : null,
                        state: state.state
                    });
                }
                return;
            }

            const counts = state.nonActiveEventCounts || {};
            counts[event] = (counts[event] || 0) + 1;
            state.nonActiveEventCounts = counts;

            const lastLog = state.lastNonActiveEventLogTime || 0;
            if (now - lastLog < CONFIG.logging.NON_ACTIVE_LOG_MS) {
                return;
            }

            state.lastNonActiveEventLogTime = now;
            const summary = { ...counts };
            state.nonActiveEventCounts = {};

            logDebug(LogEvents.tagged('EVENT_SUMMARY', 'Non-active'), {
                events: summary,
                sinceMs: lastLog ? (now - lastLog) : null,
                state: state.state
            });
        };

        return { logEvent };
    };

    return { create };
})();
