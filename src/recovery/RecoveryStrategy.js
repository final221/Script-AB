// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * @responsibility Implement strategy pattern for recovery selection.
 */
const RecoveryStrategy = (() => {
    return {
        select: (video, options = {}) => {
            // Manual overrides for testing only
            if (options.forceExperimental) {
                return ExperimentalRecovery;
            }
            if (options.forceAggressive) {
                return AggressiveRecovery;
            }
            if (options.forceStandard) {
                return StandardRecovery;
            }

            // Normal automatic flow - always start with Standard
            // Cascade to experimental/aggressive handled by ResilienceOrchestrator
            const analysis = BufferAnalyzer.analyze(video);
            Logger.add('Recovery strategy selection', {
                initialStrategy: 'Standard',
                bufferHealth: analysis.bufferHealth,
                bufferSize: analysis.bufferSize,
                forced: false
            });

            return StandardRecovery;
        }
    };
})();
