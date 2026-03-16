// --- ExternalSignalHandlerAsset ---
// @module ExternalSignalHandlerAsset
// @depends ExternalAssetRecoveryProcess
/**
 * Handles processing/offline asset signals.
 */
const ExternalSignalHandlerAsset = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const logDebug = options.logDebug || (() => {});
        const onRescan = options.onRescan || (() => {});

        let processCounter = 0;
        let activeProcessId = null;
        const getActiveId = () => (
            typeof candidateSelector?.getActiveId === 'function'
                ? candidateSelector.getActiveId()
                : null
        );

        return (signal = {}, helpers = {}) => {
            if (activeProcessId) {
                Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery already running'), {
                    activeProcessId
                });
                return true;
            }

            processCounter += 1;
            const processId = `asset-${processCounter}`;
            activeProcessId = processId;
            const truncateMessage = typeof helpers.truncateMessage === 'function'
                ? helpers.truncateMessage
                : (message) => String(message).substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN);
            const signalLevel = signal.level || 'unknown';
            const signalMessage = truncateMessage(signal.message || '');
            const activeBefore = getActiveId();
            const strictVerifyMs = CONFIG.stall.PROCESSING_ASSET_STRICT_VERIFY_MS || 600;
            const probeWindowMs = CONFIG.stall.PROCESSING_ASSET_PROBE_WINDOW_MS || 1200;
            const speculativeTimeoutMs = CONFIG.stall.PROCESSING_ASSET_SPECULATIVE_TIMEOUT_MS || 800;

            Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing/offline asset recovery initiated'), {
                processId,
                level: signalLevel,
                message: signalMessage,
                activeVideoId: activeBefore,
                monitorCount: monitorsById?.size || 0,
                strictVerifyMs,
                probeWindowMs,
                speculativeTimeoutMs
            });

            Promise.resolve().then(async () => {
                await ExternalAssetRecoveryProcess.run({
                    processId,
                    signalLevel,
                    signalMessage,
                    activeBefore,
                    helpers,
                    monitorsById,
                    candidateSelector,
                    recoveryManager,
                    onRescan
                });
            }).catch((error) => {
                Logger.add(LogEvents.tagged('ERROR', 'Processing asset recovery process failed'), {
                    processId,
                    error: error?.name,
                    message: error?.message
                });
            }).finally(() => {
                if (activeProcessId === processId) {
                    activeProcessId = null;
                }
            });

            return true;
        };
    };

    return { create };
})();
