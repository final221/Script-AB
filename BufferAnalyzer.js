// --- Buffer Analyzer ---
/**
 * Analyzes video buffer state to determine recovery strategy.
 * @responsibility Calculate buffer health and determine if aggressive recovery is needed.
 */
const BufferAnalyzer = (() => {
    return {
        analyze: (video) => {
            if (!video || !video.buffered || video.buffered.length === 0) {
                return {
                    needsAggressive: false,
                    bufferEnd: 0,
                    bufferStart: 0,
                    currentTime: video ? video.currentTime : 0,
                    bufferSize: 0,
                    bufferHealth: 'unknown'
                };
            }

            const currentTime = video.currentTime;
            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            const bufferStart = video.buffered.start(0);
            const bufferSize = bufferEnd - bufferStart;

            // Check if stuck at buffer end
            const atBufferEnd = Math.abs(currentTime - bufferEnd) < 0.5;
            const hasHealthyBuffer = bufferSize >= CONFIG.player.BUFFER_HEALTH_S;

            let bufferHealth = 'healthy';
            if (bufferSize < CONFIG.player.BUFFER_HEALTH_S) {
                bufferHealth = 'critical';
            } else if (bufferSize < CONFIG.player.BUFFER_HEALTH_S * 2) {
                bufferHealth = 'low';
            }

            return {
                needsAggressive: atBufferEnd && hasHealthyBuffer,
                bufferEnd,
                bufferStart,
                currentTime,
                bufferSize,
                bufferHealth
            };
        }
    };
})();
