// --- ConsoleInterceptor ---
/**
 * Captures console output and forwards to callbacks.
 */
const ConsoleInterceptor = (() => {
    const create = (options = {}) => {
        const onLog = options.onLog || (() => {});
        const onInfo = options.onInfo || (() => {});
        const onDebug = options.onDebug || (() => {});
        const onWarn = options.onWarn || (() => {});
        const onError = options.onError || (() => {});

        const intercept = (level, handler) => {
            const original = console[level];
            console[level] = (...args) => {
                original.apply(console, args);
                try {
                    handler(args);
                } catch (e) {
                    // Avoid recursion
                }
            };
        };

        const attach = () => {
            intercept('log', onLog);
            intercept('info', onInfo);
            intercept('debug', onDebug);
            intercept('warn', onWarn);
            intercept('error', onError);
        };

        return { attach };
    };

    return { create };
})();
