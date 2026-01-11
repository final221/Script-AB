// --- ConsoleSignalDetector ---
/**
 * Detects console messages that hint at playback issues.
 */
const ConsoleSignalDetector = (() => {
    const SIGNAL_THROTTLE_MS = 2000;
    const SIGNAL_PATTERNS = {
        PLAYHEAD_STALL: /playhead stalling at/i,
        PROCESSING_ASSET: /404_processing_640x360\.png/i,
    };

    const create = (options = {}) => {
        const emitSignal = options.emitSignal || (() => {});
        const lastSignalTimes = {
            playhead_stall: 0,
            processing_asset: 0
        };

        const maybeEmit = (type, message, level) => {
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
            emitSignal({
                type,
                level,
                message,
                timestamp: new Date().toISOString()
            });
        };

        const detect = (level, message) => {
            if (SIGNAL_PATTERNS.PLAYHEAD_STALL.test(message)) {
                maybeEmit('playhead_stall', message, level);
            }
            if (SIGNAL_PATTERNS.PROCESSING_ASSET.test(message)) {
                maybeEmit('processing_asset', message, level);
            }
        };

        return { detect };
    };

    return { create };
})();
