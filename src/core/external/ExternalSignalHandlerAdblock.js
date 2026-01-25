// --- ExternalSignalHandlerAdblock ---
/**
 * Handles adblock resource signals.
 */
const ExternalSignalHandlerAdblock = (() => {
    const create = () => (
        (signal = {}, helpers = {}) => {
            Logger.add(LogEvents.tagged('ADBLOCK_HINT', 'Ad-block signal observed'), {
                type: signal.type || 'unknown',
                level: signal.level || 'unknown',
                message: helpers.truncateMessage(signal.message || ''),
                url: signal.url ? helpers.truncateMessage(signal.url) : null
            });
            return true;
        }
    );

    return { create };
})();
