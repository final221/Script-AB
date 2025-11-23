// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * @responsibility Implement strategy pattern for recovery selection.
 */
const RecoveryStrategy = (() => {
    return {
        select: (video, forceAggressive = false) => {
            const analysis = BufferAnalyzer.analyze(video);

            Logger.add('Recovery strategy selection', {
                needsAggressive: analysis.needsAggressive || forceAggressive,
                bufferHealth: analysis.bufferHealth,
                bufferSize: analysis.bufferSize,
                forced: forceAggressive
            });

            if (forceAggressive || analysis.needsAggressive) {
                return AggressiveRecovery;
            }

            return StandardRecovery;
        }
    };
})();
