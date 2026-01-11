// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior.
 * Streamlined: Captures console output for debugging timeline, no recovery triggering.
 * Recovery is now handled entirely by StreamHealer.monitor().
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;
    const SIGNAL_THROTTLE_MS = 2000;
    const SIGNAL_PATTERNS = {
        PLAYHEAD_STALL: /playhead stalling at/i,
        PROCESSING_ASSET: /404_processing_640x360\.png/i,
    };
    const lastSignalTimes = {
        playhead_stall: 0,
        processing_asset: 0
    };
    let externalSignalHandler = null;

    // Helper to capture video state for logging
    const getVideoState = () => {
        const video = document.querySelector('video');
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };
        return {
            currentTime: video.currentTime?.toFixed(2),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: video.buffered.length > 0 ?
                `${video.buffered.end(video.buffered.length - 1).toFixed(2)}` : 'empty',
            error: video.error?.code
        };
    };

    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            const classification = classifyError(event.error, event.message || '');

            Logger.add('[INSTRUMENT:ERROR] Global error caught', {
                message: event.message,
                filename: event.filename?.split('/').pop(),
                lineno: event.lineno,
                severity: classification.severity,
                action: classification.action,
                videoState: getVideoState()
            });

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }
        });

        window.addEventListener('unhandledrejection', (event) => {
            Logger.add('[INSTRUMENT:REJECTION] Unhandled promise rejection', {
                reason: event.reason ? String(event.reason).substring(0, 200) : 'Unknown',
                severity: 'MEDIUM',
                videoState: getVideoState()
            });
            Metrics.increment('errors');
        });
    };

    const emitExternalSignal = (signal) => {
        if (!externalSignalHandler) return;
        try {
            externalSignalHandler(signal);
        } catch (e) {
            Logger.add('[INSTRUMENT:ERROR] External signal handler failed', {
                error: e?.name,
                message: e?.message
            });
        }
    };

    const maybeEmitSignal = (type, message, level) => {
        const now = Date.now();
        const lastTime = lastSignalTimes[type] || 0;
        if (now - lastTime < SIGNAL_THROTTLE_MS) {
            return;
        }
        lastSignalTimes[type] = now;
        Logger.add('[INSTRUMENT:CONSOLE_HINT] Console signal detected', {
            type,
            level,
            message: message.substring(0, 300)
        });
        emitExternalSignal({
            type,
            level,
            message,
            timestamp: new Date().toISOString()
        });
    };

    const detectConsoleSignals = (level, message) => {
        if (SIGNAL_PATTERNS.PLAYHEAD_STALL.test(message)) {
            maybeEmitSignal('playhead_stall', message, level);
        }
        if (SIGNAL_PATTERNS.PROCESSING_ASSET.test(message)) {
            maybeEmitSignal('processing_asset', message, level);
        }
    };

    // Capture console.log for timeline correlation
    const interceptConsoleLog = () => {
        const originalLog = console.log;

        console.log = (...args) => {
            originalLog.apply(console, args);
            try {
                Logger.captureConsole('log', args);
            } catch (e) {
                // Avoid recursion
            }
        };
    };

    const interceptConsoleError = () => {
        const originalError = console.error;

        console.error = (...args) => {
            originalError.apply(console, args);
            try {
                Logger.captureConsole('error', args);

                const msg = args.map(String).join(' ');
                const classification = classifyError(null, msg);

                Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                    message: msg.substring(0, 300),
                    severity: classification.severity,
                    action: classification.action
                });

                detectConsoleSignals('error', msg);

                if (classification.action !== 'LOG_ONLY') {
                    Metrics.increment('errors');
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    const interceptConsoleWarn = () => {
        const originalWarn = console.warn;

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                Logger.captureConsole('warn', args);

                const msg = args.map(String).join(' ');

                detectConsoleSignals('warn', msg);

                // Log CSP warnings for debugging
                if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                    Logger.add('[INSTRUMENT:CSP] CSP warning', {
                        message: msg.substring(0, 200),
                        severity: 'LOW'
                    });
                }
            } catch (e) {
                // Avoid recursion if logging fails
            }
        };
    };

    return {
        init: (options = {}) => {
            externalSignalHandler = typeof options.onSignal === 'function'
                ? options.onSignal
                : null;
            Logger.add('[INSTRUMENT:INIT] Instrumentation initialized', {
                features: ['globalErrors', 'consoleLogs', 'consoleErrors', 'consoleWarns'],
                consoleCapture: true,
                externalSignals: Boolean(externalSignalHandler)
            });
            setupGlobalErrorHandlers();
            interceptConsoleLog();
            interceptConsoleError();
            interceptConsoleWarn();
        },
    };
})();
