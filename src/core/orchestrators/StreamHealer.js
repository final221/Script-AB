// --- StreamHealer ---
/**
 * Main orchestrator for stream healing.
 * Detects stalls and coordinates the heal point finding and seeking.
 */
const StreamHealer = (() => {
    const FALLBACK_SOURCE_PATTERN = /(404_processing|_404\/404_processing|_404_processing|_404)/i;

    const isFallbackSource = (src) => src && FALLBACK_SOURCE_PATTERN.test(src);

    let defaultInstance = null;

    const create = () => {
        const logDebug = LogDebug.create();
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
            Logger.add(message, LogContext.fromContext(context, detail));
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
    };

    const getDefault = () => {
        if (!defaultInstance) {
            defaultInstance = create();
        }
        return defaultInstance;
    };

    const setDefault = (instance) => {
        defaultInstance = instance;
    };

    const callDefault = (method) => (...args) => getDefault()[method](...args);

    return {
        create,
        getDefault,
        setDefault,
        monitor: callDefault('monitor'),
        stopMonitoring: callDefault('stopMonitoring'),
        onStallDetected: callDefault('onStallDetected'),
        attemptHeal: callDefault('attemptHeal'),
        handleExternalSignal: callDefault('handleExternalSignal'),
        scanForVideos: callDefault('scanForVideos'),
        getStats: callDefault('getStats')
    };
})();
