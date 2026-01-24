// --- ResourceWindow ---
/**
 * Tracks network resource activity for stall-adjacent windows.
 */
const ResourceWindow = (() => {
    const resourceEvents = [];
    const pendingWindows = new Map();

    const truncateUrl = (url) => (
        String(url).substring(0, CONFIG.logging.LOG_URL_MAX_LEN)
    );

    const record = (url, initiatorType) => {
        const now = Date.now();
        resourceEvents.push({
            ts: now,
            url: truncateUrl(url),
            initiatorType: initiatorType || null
        });

        const maxEntries = CONFIG.logging.RESOURCE_WINDOW_MAX || 8000;
        if (resourceEvents.length > maxEntries) {
            resourceEvents.splice(0, resourceEvents.length - maxEntries);
        }
    };

    const logWindow = (detail = {}) => {
        const stallTime = detail.stallTime || Date.now();
        const stallKey = Number.isFinite(detail.stallKey) ? detail.stallKey : stallTime;
        const videoId = detail.videoId || 'unknown';
        const key = `${videoId}:${stallKey}`;
        if (pendingWindows.has(key)) return;
        pendingWindows.set(key, true);

        const pastMs = CONFIG.logging.RESOURCE_WINDOW_PAST_MS || 30000;
        const futureMs = CONFIG.logging.RESOURCE_WINDOW_FUTURE_MS || 60000;

        Logger.add('[INSTRUMENT:RESOURCE_WINDOW_SCHEDULED]', {
            videoId,
            reason: detail.reason || 'stall',
            stalledFor: detail.stalledFor || null,
            windowPastMs: pastMs,
            windowFutureMs: futureMs
        });

        setTimeout(() => {
            const start = stallTime - pastMs;
            const end = stallTime + futureMs;
            const entries = resourceEvents
                .filter(item => item.ts >= start && item.ts <= end)
                .map(item => ({
                    offsetMs: item.ts - stallTime,
                    url: item.url,
                    initiatorType: item.initiatorType
                }));

            Logger.add('[INSTRUMENT:RESOURCE_WINDOW]', {
                videoId,
                reason: detail.reason || 'stall',
                stalledFor: detail.stalledFor || null,
                windowPastMs: pastMs,
                windowFutureMs: futureMs,
                total: entries.length,
                requests: entries
            });
            pendingWindows.delete(key);
        }, futureMs);
    };

    return {
        record,
        logWindow
    };
})();
