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

    const logWithState = (message, video, detail = {}) => {
        Logger.add(message, {
            ...detail,
            videoState: VideoState.get(video, monitoring.getVideoId(video))
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
