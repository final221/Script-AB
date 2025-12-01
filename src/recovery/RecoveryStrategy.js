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
        },

        /**
         * Determines the next strategy to try if the current one failed or was insufficient.
         * @param {HTMLVideoElement} video - The video element
         * @param {Object} lastStrategy - The strategy that was just executed
         * @returns {Object|null} The next strategy to try, or null if no further escalation
         */
        getEscalation: (video, lastStrategy) => {
            const analysis = BufferAnalyzer.analyze(video);

            // If we just ran StandardRecovery and buffer is still critical
            if (lastStrategy === StandardRecovery) {
                if (analysis.needsAggressive) {
                    if (ExperimentalRecovery.isEnabled() && ExperimentalRecovery.hasStrategies()) {
                        Logger.add('[RECOVERY] Standard insufficient, escalating to Experimental');
                        return ExperimentalRecovery;
                    } else {
                        Logger.add('[RECOVERY] Standard insufficient, escalating to Aggressive');
                        return AggressiveRecovery;
                    }
                }
            }

            // If we just ran ExperimentalRecovery and buffer is still critical
            if (lastStrategy === ExperimentalRecovery) {
                if (analysis.needsAggressive) {
                    Logger.add('[RECOVERY] Experimental insufficient, escalating to Aggressive');
                    return AggressiveRecovery;
                }
            }

            return null;
        }
    };
})();
