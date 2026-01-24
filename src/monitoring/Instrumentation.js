// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior.
 * Streamlined: Captures console output for debugging timeline, no recovery triggering.
 * Recovery is now handled entirely by StreamHealer.monitor().
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;
    let externalSignalHandler = null;
    let signalDetector = null;
    const PROCESSING_ASSET_PATTERN = /404_processing_640x360\.png/i;
    let lastResourceHintTime = 0;
    const truncateMessage = (message, maxLen) => (
        String(message).substring(0, maxLen)
    );

    // Helper to capture video state for logging
    const getVideoState = () => {
        const video = document.querySelector('video');
        if (!video) return { error: 'NO_VIDEO_ELEMENT' };
        let bufferedState = 'empty';
        try {
            if (video.buffered?.length > 0) {
                bufferedState = `${video.buffered.end(video.buffered.length - 1).toFixed(2)}`;
            }
        } catch (error) {
            bufferedState = 'unavailable';
        }
        return {
            currentTime: video.currentTime?.toFixed(2),
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            buffered: bufferedState,
            error: video.error?.code
        };
    };

    const setupGlobalErrorHandlers = () => {
        window.addEventListener('error', (event) => {
            const classification = classifyError(event.error, event.message || '');
            Logger.captureConsole('error', [
                `GlobalError: ${truncateMessage(event.message || 'Unknown error', CONFIG.logging.LOG_REASON_MAX_LEN)}`,
                event.filename ? `(source: ${event.filename.split('/').pop()})` : '',
                Number.isFinite(event.lineno) ? `(line: ${event.lineno})` : '',
                Number.isFinite(event.colno) ? `(col: ${event.colno})` : ''
            ].filter(Boolean).join(' '));

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
            const reason = event.reason
                ? truncateMessage(event.reason, CONFIG.logging.LOG_REASON_MAX_LEN)
                : 'Unknown';
            Logger.captureConsole('error', [
                'UnhandledRejection:',
                reason
            ]);
            Logger.add('[INSTRUMENT:REJECTION] Unhandled promise rejection', {
                reason,
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

    const maybeEmitProcessingAsset = (url) => {
        const now = Date.now();
        if (now - lastResourceHintTime < CONFIG.logging.RESOURCE_HINT_THROTTLE_MS) {
            return;
        }
        lastResourceHintTime = now;
        Logger.add('[INSTRUMENT:RESOURCE_HINT] Processing asset requested', {
            url: truncateMessage(url, CONFIG.logging.LOG_URL_MAX_LEN)
        });
        emitExternalSignal({
            type: 'processing_asset',
            level: 'resource',
            message: truncateMessage(url, CONFIG.logging.LOG_URL_MAX_LEN),
            timestamp: new Date().toISOString()
        });
    };

    const logResourceWindow = (detail = {}) => {
        ResourceWindow.logWindow(detail);
    };

    const setupResourceObserver = () => {
        if (typeof window === 'undefined' || !window.PerformanceObserver) return;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry?.name) continue;
                    ResourceWindow.record(entry.name, entry.initiatorType);
                    if (PROCESSING_ASSET_PATTERN.test(entry.name)) {
                        maybeEmitProcessingAsset(entry.name);
                    }
                }
            });
            observer.observe({ type: 'resource', buffered: true });
        } catch (error) {
            Logger.add('[INSTRUMENT:RESOURCE_ERROR] Resource observer failed', {
                error: error?.name,
                message: error?.message
            });
        }
    };

    const consoleInterceptor = ConsoleInterceptor.create({
        onLog: (args) => {
            Logger.captureConsole('log', args);
            const msg = args.map(String).join(' ');
            if (signalDetector) {
                signalDetector.detect('log', msg);
            }
        },
        onInfo: (args) => {
            Logger.captureConsole('info', args);
            const msg = args.map(String).join(' ');
            if (signalDetector) {
                signalDetector.detect('info', msg);
            }
        },
        onDebug: (args) => {
            Logger.captureConsole('debug', args);
            const msg = args.map(String).join(' ');
            if (signalDetector) {
                signalDetector.detect('debug', msg);
            }
        },
        onError: (args) => {
            Logger.captureConsole('error', args);

            const msg = args.map(String).join(' ');
            const classification = classifyError(null, msg);

            Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                message: truncateMessage(msg, CONFIG.logging.LOG_MESSAGE_MAX_LEN),
                severity: classification.severity,
                action: classification.action
            });

            if (signalDetector) {
                signalDetector.detect('error', msg);
            }

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }
        },
        onWarn: (args) => {
            Logger.captureConsole('warn', args);

            const msg = args.map(String).join(' ');

            if (signalDetector) {
                signalDetector.detect('warn', msg);
            }

            if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
                Logger.add('[INSTRUMENT:CSP] CSP warning', {
                    message: truncateMessage(msg, CONFIG.logging.LOG_REASON_MAX_LEN),
                    severity: 'LOW'
                });
            }
        }
    });

    return {
        init: (options = {}) => {
            externalSignalHandler = typeof options.onSignal === 'function'
                ? options.onSignal
                : null;
            signalDetector = ConsoleSignalDetector.create({
                emitSignal: emitExternalSignal
            });
            Logger.add('[INSTRUMENT:INIT] Instrumentation initialized', {
                features: ['globalErrors', 'consoleLogs', 'consoleInfo', 'consoleDebug', 'consoleErrors', 'consoleWarns'],
                consoleCapture: true,
                externalSignals: Boolean(externalSignalHandler)
            });
            setupGlobalErrorHandlers();
            setupResourceObserver();
            consoleInterceptor.attach();
        },
        logResourceWindow
    };
})();


