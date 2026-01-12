// --- ConsoleSignalDetector ---
/**
 * Detects console messages that hint at playback issues.
 */
const ConsoleSignalDetector = (() => {
    const SIGNAL_PATTERNS = {
        PLAYHEAD_STALL: /playhead stalling at/i,
        PROCESSING_ASSET: /404_processing_640x360\.png/i,
    };

    const parsePlayheadStall = (message) => {
        const match = message.match(/playhead stalling at\s*([0-9.]+)\s*,\s*buffer end\s*([0-9.]+)/i);
        if (!match) return null;
        const playheadSeconds = Number.parseFloat(match[1]);
        const bufferEndSeconds = Number.parseFloat(match[2]);
        if (!Number.isFinite(playheadSeconds) || !Number.isFinite(bufferEndSeconds)) {
            return null;
        }
        return { playheadSeconds, bufferEndSeconds };
    };

    const create = (options = {}) => {
        const emitSignal = options.emitSignal || (() => {});
        const lastSignalTimes = {
            playhead_stall: 0,
            processing_asset: 0
        };

        const maybeEmit = (type, message, level, detail = null) => {
            const now = Date.now();
            const lastTime = lastSignalTimes[type] || 0;
            if (now - lastTime < CONFIG.logging.CONSOLE_SIGNAL_THROTTLE_MS) {
                return;
            }
            lastSignalTimes[type] = now;
            Logger.add('[INSTRUMENT:CONSOLE_HINT] Console signal detected', {
                type,
                level,
                message: message.substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN),
                ...(detail || {})
            });
            emitSignal({
                type,
                level,
                message,
                timestamp: new Date().toISOString(),
                ...(detail || {})
            });
        };

        const detect = (level, message) => {
            if (SIGNAL_PATTERNS.PLAYHEAD_STALL.test(message)) {
                const detail = parsePlayheadStall(message);
                maybeEmit('playhead_stall', message, level, detail);
            }
            if (SIGNAL_PATTERNS.PROCESSING_ASSET.test(message)) {
                maybeEmit('processing_asset', message, level);
            }
        };

        return { detect };
    };

    return { create };
})();
