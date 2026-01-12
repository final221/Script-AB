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

    const maybeEmitProcessingAsset = (url) => {
        const now = Date.now();
        if (now - lastResourceHintTime < 2000) {
            return;
        }
        lastResourceHintTime = now;
        Logger.add('[INSTRUMENT:RESOURCE_HINT] Processing asset requested', {
            url: String(url).substring(0, 200)
        });
        emitExternalSignal({
            type: 'processing_asset',
            level: 'resource',
            message: String(url),
            timestamp: new Date().toISOString()
        });
    };

    const setupResourceObserver = () => {
        if (typeof window === 'undefined' || !window.PerformanceObserver) return;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry?.name && PROCESSING_ASSET_PATTERN.test(entry.name)) {
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
        },
        onError: (args) => {
            Logger.captureConsole('error', args);

            const msg = args.map(String).join(' ');
            const classification = classifyError(null, msg);

            Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                message: msg.substring(0, 300),
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
                    message: msg.substring(0, 200),
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
                features: ['globalErrors', 'consoleLogs', 'consoleErrors', 'consoleWarns'],
                consoleCapture: true,
                externalSignals: Boolean(externalSignalHandler)
            });
            setupGlobalErrorHandlers();
            setupResourceObserver();
            consoleInterceptor.attach();
        },
    };
})();
