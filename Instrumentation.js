// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior,
 * log relevant data, and update metrics.
 * @responsibility Observes, interprets, and reacts to system-wide events and console output.
 */
const Instrumentation = (() => {
    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            Logger.add('Global Error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
            });
            Metrics.increment('errors');
        });

        window.addEventListener('unhandledrejection', (event) => {
            Logger.add('Unhandled Rejection', {
                reason: event.reason ? event.reason.toString() : 'Unknown',
            });
            Metrics.increment('errors');
        });
    };

    const interceptConsoleError = () => {
        const originalError = console.error;
        const benignErrorSignatures = ['[GraphQL]', 'unauthenticated', 'PinnedChatSettings'];

        console.error = (...args) => {
            originalError.apply(console, args);
            try {
                const msg = args.map(String).join(' ');
                const isBenign = benignErrorSignatures.some(sig => msg.includes(sig));
                Logger.add('Console Error', { args: args.map(String), benign: isBenign });

                if (!isBenign) {
                    Metrics.increment('errors');
                    if (msg.includes('Error #4000') || msg.includes('MediaLoadInvalidURI')) {
                        Logger.add('Player crash detected, triggering recovery');
                        setTimeout(() => Adapters.EventBus.emit(CONFIG.events.AD_DETECTED), 300);
                    }
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    const interceptConsoleWarn = () => {
        const originalWarn = console.warn;
        const stallingDebounced = Fn.debounce(() => {
            Logger.add('Critical warning: Playhead stalling (debounced)');
            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
        }, 10000);

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                const msg = args.map(String).join(' ');
                if (msg.includes('Playhead stalling')) {
                    Logger.add('Playhead stalling warning detected (raw)');
                    stallingDebounced();
                } else if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                    Logger.add('CSP Warning', { args: args.map(String) });
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    return {
        init: () => {
            setupGlobalErrorHandlers();
            interceptConsoleError();
            interceptConsoleWarn();
        },
    };
})();
