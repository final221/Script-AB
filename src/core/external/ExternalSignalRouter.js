// --- ExternalSignalRouter ---
/**
 * Handles console-based external signal hints for recovery actions.
 */
const ExternalSignalRouter = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const logDebug = options.logDebug || (() => {});
        const onStallDetected = options.onStallDetected || (() => {});
        const onRescan = options.onRescan || (() => {});
        const playheadAttribution = PlayheadAttribution.create({
            monitorsById,
            candidateSelector,
            matchWindowSeconds: 2
        });
        const helpers = {
            formatSeconds: ExternalSignalUtils.formatSeconds,
            truncateMessage: ExternalSignalUtils.truncateMessage,
            getActiveEntry: ExternalSignalUtils.getActiveEntry,
            logCandidateSnapshot: ExternalSignalUtils.logCandidateSnapshot,
            probeCandidates: ExternalSignalUtils.probeCandidates
        };
        const handlers = {
            playhead_stall: ExternalSignalHandlerStall.create({
                monitorsById,
                candidateSelector,
                onStallDetected,
                playheadAttribution
            }),
            processing_asset: ExternalSignalHandlerAsset.create({
                monitorsById,
                candidateSelector,
                recoveryManager,
                logDebug,
                onRescan
            }),
            adblock_block: ExternalSignalHandlerAdblock.create()
        };
        const fallbackHandler = ExternalSignalHandlerFallback.create();

        const handleSignal = (signal = {}) => {
            if (!signal || monitorsById.size === 0) return;

            const type = signal.type || 'unknown';
            const handler = handlers[type] || fallbackHandler;
            handler(signal, helpers);
        };

        return { handleSignal };
    };

    return { create };
})();


