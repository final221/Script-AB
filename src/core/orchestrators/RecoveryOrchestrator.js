// --- RecoveryOrchestrator ---
/**
 * Coordinates stall handling, healing, and external signal recovery.
 * Inputs: monitoring facade + log helpers.
 * Outputs: onStallDetected/attemptHeal/external signal handlers.
 */
const RecoveryOrchestrator = (() => {
    const create = (options = {}) => {
        const monitoring = options.monitoring;
        const logWithState = options.logWithState;
        const logDebug = options.logDebug || (() => {});

        const monitorsById = monitoring.monitorsById;
        const candidateSelector = monitoring.candidateSelector;
        const recoveryManager = monitoring.recoveryManager;
        const getVideoId = monitoring.getVideoId;

        const healPipeline = HealPipeline.create({
            getVideoId,
            logWithState,
            logDebug,
            recoveryManager,
            isActive: (videoId) => candidateSelector.getActiveId() === videoId,
            onDetached: (video, reason) => {
                monitoring.scanForVideos('detached', {
                    reason,
                    videoId: getVideoId(video)
                });
            }
        });

        const stallHandler = StallHandler.create({
            candidateSelector,
            recoveryManager,
            getVideoId,
            logDebug,
            healPipeline,
            scanForVideos: monitoring.scanForVideos
        });

        const onStallDetected = stallHandler.onStallDetected;
        monitoring.setStallHandler(onStallDetected);

        const externalSignalRouter = ExternalSignalRouter.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug,
            onStallDetected,
            onRescan: (reason, detail) => monitoring.scanForVideos(reason, detail)
        });

        return {
            onStallDetected,
            attemptHeal: (video, state) => healPipeline.attemptHeal(video, state),
            handleExternalSignal: (signal = {}) => externalSignalRouter.handleSignal(signal),
            isHealing: (videoId) => healPipeline.isHealing(videoId),
            getAttempts: () => healPipeline.getAttempts()
        };
    };

    return { create };
})();

