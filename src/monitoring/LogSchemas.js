// --- LogSchemas ---
/**
 * Optional key ordering hints for log detail payloads.
 */
const LogSchemas = (() => {
    const getSchema = (rawTag) => {
        if (typeof LogTagRegistry !== 'undefined' && LogTagRegistry?.getSchema) {
            return LogTagRegistry.getSchema(rawTag);
        }
        return null;
    };

    return { getSchema };
})();
