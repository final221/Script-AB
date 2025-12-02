// --- Recovery Diagnostics ---
/**
 * Diagnoses playback blockers before attempting recovery.
 * @responsibility
 * 1. Identify WHY the player is stuck.
 * 2. Suggest targeted recovery strategies.
 * 3. Prevent wasted recovery attempts on unrecoverable states.
 */
const RecoveryDiagnostics = (() => {

    /**
     * Diagnoses the current video state to determine recovery feasibility.
     * @param {HTMLVideoElement} video
     * @returns {{canRecover: boolean, blockers: string[], suggestedStrategy: string, details: Object}}
     */
    const diagnose = (video) => {
        if (!video) {
            return {
                canRecover: false,
                blockers: ['NO_VIDEO_ELEMENT'],
                suggestedStrategy: 'fatal',
                details: { error: 'Video element is null or undefined' }
            };
        }

        // 1. DOM Attachment Check
        if (!video.isConnected) {
            Logger.add('[DIAGNOSTICS] Video element detached from DOM');
            return {
                canRecover: false,
                blockers: ['VIDEO_DETACHED'],
                suggestedStrategy: 'fatal',
                details: { error: 'Video element not connected to DOM' }
            };
        }

        // 2. Media Error Check
        if (video.error) {
            const errorCode = video.error.code;
            const isFatal = errorCode === video.error.MEDIA_ERR_SRC_NOT_SUPPORTED;

            Logger.add('[DIAGNOSTICS] Media error detected', {
                code: errorCode,
                message: video.error.message
            });

            return {
                canRecover: !isFatal,
                blockers: [`MEDIA_ERROR_${errorCode}`],
                suggestedStrategy: isFatal ? 'fatal' : 'aggressive',
                details: {
                    errorCode,
                    errorMessage: video.error.message,
                    isFatal
                }
            };
        }

        // 3. Network State Check
        if (video.networkState === video.NETWORK_NO_SOURCE) {
            Logger.add('[DIAGNOSTICS] No source available');
            return {
                canRecover: false,
                blockers: ['NO_SOURCE'],
                suggestedStrategy: 'fatal',
                details: { networkState: video.networkState }
            };
        }

        // 4. Seeking State Check
        if (video.seeking) {
            Logger.add('[DIAGNOSTICS] Video currently seeking');
            return {
                canRecover: true,
                blockers: ['ALREADY_SEEKING'],
                suggestedStrategy: 'wait',
                details: {
                    suggestion: 'Wait for seek to complete',
                    currentTime: video.currentTime
                }
            };
        }

        // 5. Ready State Check
        if (video.readyState < 3) {
            Logger.add('[DIAGNOSTICS] Insufficient data', {
                readyState: video.readyState
            });

            return {
                canRecover: true,
                blockers: ['INSUFFICIENT_DATA'],
                suggestedStrategy: 'wait',
                details: {
                    readyState: video.readyState,
                    suggestion: 'Wait for buffering to complete before recovery'
                }
            };
        }

        // 6. Buffer Health Check
        const bufferAnalysis = BufferAnalyzer.analyze(video);
        // Only report critical buffer if we have actual buffered content
        if (bufferAnalysis.bufferHealth === 'critical' && video.buffered.length > 0) {
            Logger.add('[DIAGNOSTICS] Critical buffer detected', bufferAnalysis);
            return {
                canRecover: true,
                blockers: ['CRITICAL_BUFFER'],
                suggestedStrategy: 'aggressive',
                details: {
                    bufferSize: bufferAnalysis.bufferSize,
                    bufferHealth: bufferAnalysis.bufferHealth,
                    suggestion: 'Standard recovery (seeking) will fail - need stream refresh'
                }
            };
        }

        // 7. Check signature stability (if available)
        if (Logic && Logic.Player && Logic.Player.isSessionUnstable) {
            const isUnstable = Logic.Player.isSessionUnstable();
            if (isUnstable) {
                Logger.add('[DIAGNOSTICS] Warning: Player signatures unstable');
            }
        }

        // All checks passed - standard recovery can proceed
        Logger.add('[DIAGNOSTICS] Video state appears recoverable', {
            readyState: video.readyState,
            paused: video.paused,
            bufferHealth: bufferAnalysis.bufferHealth
        });

        return {
            canRecover: true,
            blockers: [],
            suggestedStrategy: 'standard',
            details: {
                readyState: video.readyState,
                paused: video.paused,
                currentTime: video.currentTime,
                bufferHealth: bufferAnalysis.bufferHealth,
                bufferSize: bufferAnalysis.bufferSize
            }
        };
    };

    return {
        diagnose
    };
})();
