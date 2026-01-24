// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;

    const logDebug = (message, detail) => {
        if (CONFIG.debug) {
            Logger.add(message, detail);
        }
    };

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);

    let recovery = {
        isHealing: () => false
    };

    const monitoring = MonitoringOrchestrator.create({
        logDebug,
        isHealing: () => recovery.isHealing(),
        isFallbackSource
    });

    const logWithState = (message, videoOrContext, detail = {}) => {
        const context = RecoveryContext.from(videoOrContext, null, monitoring.getVideoId);
        const snapshot = StateSnapshot.full(context.video, context.videoId);
        Logger.add(message, {
            ...detail,
            videoId: detail.videoId || context.videoId,
            videoState: snapshot
        });
    };

    recovery = RecoveryOrchestrator.create({
        monitoring,
        logWithState,
        logDebug
    });

    return {
        monitor: monitoring.monitor,
        stopMonitoring: monitoring.stopMonitoring,
        onStallDetected: recovery.onStallDetected,
        attemptHeal: (video, state) => recovery.attemptHeal(video, state),
        handleExternalSignal: (signal) => recovery.handleExternalSignal(signal),
        scanForVideos: monitoring.scanForVideos,
        getStats: () => ({
            healAttempts: recovery.getAttempts(),
            isHealing: recovery.isHealing(),
            monitoredCount: monitoring.getMonitoredCount()
        })
    };
})();
