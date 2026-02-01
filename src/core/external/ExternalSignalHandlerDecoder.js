// --- ExternalSignalHandlerDecoder ---
/**
 * Handles decoder/runtime error signals (IVS wasm worker failures).
 */
const ExternalSignalHandlerDecoder = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;

        return (signal = {}, helpers = {}) => {
            Logger.add(LogEvents.tagged('ERROR', 'Decoder error signal observed'), {
                type: signal.type || 'unknown',
                level: signal.level || 'unknown',
                message: helpers.truncateMessage(signal.message || ''),
                filename: signal.filename || null,
                lineno: signal.lineno || null
            });

            if (!recoveryManager?.requestRefresh) {
                return true;
            }

            const active = helpers.getActiveEntry(candidateSelector, monitorsById);
            if (!active?.entry) {
                return true;
            }

            recoveryManager.requestRefresh(active.id, active.entry.monitor?.state || null, {
                reason: 'decoder_error',
                trigger: signal.type || 'decoder_error',
                detail: signal.message || ''
            });

            return true;
        };
    };

    return { create };
})();
