// --- Instrumentation ---
/**
 * Hooks into global events and console methods to monitor application behavior.
 * REFACTORED: Enhanced logging, longer debounce, smarter recovery triggering.
 */
const Instrumentation = (() => {
    const classifyError = ErrorClassifier.classify;

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
                filename: event.filename?.split('/').pop(), // Just filename, not full path
                lineno: event.lineno,
                severity: classification.severity,
                action: classification.action,
                videoState: getVideoState()
            });

            if (classification.action !== 'LOG_ONLY') {
                Metrics.increment('errors');
            }

            if (classification.action === 'TRIGGER_RECOVERY') {
                Logger.add('[INSTRUMENT:TRIGGER] Error triggering recovery', {
                    errorType: event.error?.name || 'unknown',
                    source: 'GLOBAL_ERROR'
                });
                setTimeout(() => Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'INSTRUMENTATION',
                    trigger: 'GLOBAL_ERROR',
                    reason: event.message
                }), 300);
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

    const interceptConsoleError = () => {
        const originalError = console.error;

        console.error = (...args) => {
            originalError.apply(console, args);
            try {
                const msg = args.map(String).join(' ');
                const classification = classifyError(null, msg);

                Logger.add('[INSTRUMENT:CONSOLE_ERROR] Console error intercepted', {
                    message: msg.substring(0, 300), // Truncate long messages
                    severity: classification.severity,
                    action: classification.action
                });

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

        // Track stalling detection
        let lastStallDetection = 0;
        let stallCount = 0;

        // INCREASED: 30 second debounce (was 10s) - give player time to self-recover
        const stallingDebounced = Fn.debounce(() => {
            const video = document.querySelector('video');
            const videoState = getVideoState();

            // NEW: Check if player already recovered before triggering
            if (video && !video.paused && video.readyState >= 3) {
                Logger.add('[INSTRUMENT:STALL_RECOVERED] Player recovered before debounce fired', {
                    stallCount,
                    videoState,
                    action: 'SKIPPING_RECOVERY'
                });
                stallCount = 0; // Reset
                return; // Don't trigger recovery - already fixed
            }

            Logger.add('[INSTRUMENT:STALL_TRIGGER] Playhead stalling - triggering recovery', {
                stallCount,
                debounceMs: 30000,
                videoState,
                action: 'EMITTING_AD_DETECTED'
            });

            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                source: 'INSTRUMENTATION',
                trigger: 'PLAYHEAD_STALLING',
                reason: 'Playhead stalled for 30+ seconds',
                details: { stallCount, videoState }
            });

            stallCount = 0; // Reset after trigger
        }, 30000); // INCREASED from 10000

        console.warn = (...args) => {
            originalWarn.apply(console, args);
            try {
                const msg = args.map(String).join(' ');

                // Critical playback warning
                if (msg.toLowerCase().includes('playhead stalling')) {
                    stallCount++;
                    const now = Date.now();
                    const timeSinceLast = lastStallDetection ? (now - lastStallDetection) / 1000 : 0;
                    lastStallDetection = now;

                    Logger.add('[INSTRUMENT:STALL_DETECTED] Playhead stalling warning', {
                        stallCount,
                        timeSinceLastStall: timeSinceLast.toFixed(1) + 's',
                        videoState: getVideoState(),
                        debounceActive: true,
                        debounceMs: 30000,
                        originalMessage: msg.substring(0, 100)
                    });

                    stallingDebounced();
                }
                // CSP warnings (informational)
                else if (CONFIG.logging.LOG_CSP_WARNINGS && msg.includes('Content-Security-Policy')) {
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
        init: () => {
            Logger.add('[INSTRUMENT:INIT] Instrumentation initialized', {
                features: ['globalErrors', 'consoleErrors', 'consoleWarns', 'stallDetection'],
                stallDebounceMs: 30000
            });
            setupGlobalErrorHandlers();
            interceptConsoleError();
            interceptConsoleWarn();
        },
    };
})();


