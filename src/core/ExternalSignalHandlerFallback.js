// --- ExternalSignalHandlerFallback ---
/**
 * Logs unhandled external signals.
 */
const ExternalSignalHandlerFallback = (() => {
    const create = () => (
        (signal = {}, helpers = {}) => {
            Logger.add(LogEvents.tagged('EXTERNAL', 'Unhandled external signal'), {
                type: signal.type || 'unknown',
                level: signal.level || 'unknown',
                message: helpers.truncateMessage(signal.message || '')
            });
            return true;
        }
    );

    return { create };
})();
