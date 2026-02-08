// @module StreamHealer
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
            isHealing: (videoId) => recovery.isHealing(videoId),
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

        const triggerLastResortRefresh = (options = {}) => {
            const activeId = monitoring.candidateSelector.getActiveId();
            const fallbackId = monitoring.monitorsById.keys().next().value || null;
            const targetVideoId = options.videoId || activeId || fallbackId;
            if (!targetVideoId) {
                Logger.add(LogEvents.tagged('REFRESH', 'Manual last-resort refresh skipped (no monitored video)'), {
                    reason: 'manual_last_resort',
                    activeVideoId: activeId || null,
                    monitoredCount: monitoring.getMonitoredCount()
                });
                return {
                    ok: false,
                    reason: 'no_monitored_video',
                    activeVideoId: activeId || null
                };
            }

            const entry = monitoring.monitorsById.get(targetVideoId);
            const monitorState = entry?.monitor?.state || null;
            const eligibility = monitoring.recoveryManager.canRequestRefresh(targetVideoId, monitorState, {
                reason: 'manual_last_resort',
                trigger: 'manual_command',
                ignoreRefreshCooldown: true
            });
            const refreshed = eligibility.allow && monitoring.recoveryManager.requestRefresh(targetVideoId, monitorState, {
                reason: 'manual_last_resort',
                trigger: 'manual_command',
                detail: options.detail || 'manual_last_resort',
                forcePageRefresh: true,
                ignoreRefreshCooldown: true,
                eligibility
            });

            Logger.add(LogEvents.tagged('REFRESH', 'Manual last-resort refresh requested'), {
                videoId: targetVideoId,
                refreshEligible: eligibility.allow,
                refreshEligibilityReason: eligibility.reason || null,
                refreshed
            });

            return {
                ok: refreshed,
                videoId: targetVideoId,
                refreshEligible: eligibility.allow,
                refreshEligibilityReason: eligibility.reason || null
            };
        };

        return {
            monitor: monitoring.monitor,
            stopMonitoring: monitoring.stopMonitoring,
            onStallDetected: recovery.onStallDetected,
            attemptHeal: (video, state) => recovery.attemptHeal(video, state),
            handleExternalSignal: (signal) => recovery.handleExternalSignal(signal),
            scanForVideos: monitoring.scanForVideos,
            triggerLastResortRefresh,
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
        triggerLastResortRefresh: callDefault('triggerLastResortRefresh'),
        getStats: callDefault('getStats')
    };
})();
