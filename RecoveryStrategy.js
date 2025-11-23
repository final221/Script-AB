// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * @responsibility Implement strategy pattern for recovery selection.
 */
const RecoveryStrategy = (() => {
    return {
        select: (video) => {
            const analysis = BufferAnalyzer.analyze(video);

            Logger.add('Recovery strategy selection', {
                needsAggressive: analysis.needsAggressive,
                bufferHealth: analysis.bufferHealth,
                bufferSize: analysis.bufferSize
            });

            if (analysis.needsAggressive) {
                return AggressiveRecovery;
            }

            return StandardRecovery;
        }
    };
})();
