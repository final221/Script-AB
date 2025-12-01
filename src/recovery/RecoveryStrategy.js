// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * @responsibility Implement strategy pattern for recovery selection.
 */
const RecoveryStrategy = (() => {
    /**
     * Validates video element
     * @param {HTMLVideoElement} video - Video element to validate
     * @returns {boolean} True if valid
     */
    const validateVideo = (video) => {
        if (!video || !(video instanceof HTMLVideoElement)) {
            Logger.add('[RecoveryStrategy] Invalid video element', { video });
            return false;
        }
        return true;
    };

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
            if (!validateVideo(video)) {
                Logger.add('[RecoveryStrategy] Defaulting to Standard - invalid video');
                return StandardRecovery;
            }

            let analysis;
            try {
                analysis = BufferAnalyzer.analyze(video);
            } catch (error) {
                Logger.add('[RecoveryStrategy] BufferAnalyzer failed, defaulting to Standard', { error: String(error) });
                return StandardRecovery;
            }
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
            if (!validateVideo(video)) {
                return null; // No escalation if video invalid
            }

            let analysis;
            try {
                analysis = BufferAnalyzer.analyze(video);
            } catch (error) {
                Logger.add('[RecoveryStrategy] BufferAnalyzer failed during escalation', { error: String(error) });
                return null; // No escalation on error
            }

            // Validate analysis object
            if (!analysis || typeof analysis.needsAggressive !== 'boolean') {
                Logger.add('[RecoveryStrategy] Invalid analysis object', { analysis });
                return null;
            }

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
