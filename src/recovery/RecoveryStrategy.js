// --- Recovery Strategy ---
/**
 * Selects appropriate recovery strategy based on buffer analysis.
 * REFACTORED: Aggressive/Experimental escalation DISABLED.
 * - These strategies were causing player destruction
 * - Now always uses StandardRecovery with comprehensive logging
 */
const RecoveryStrategy = (() => {
    /**
     * Validates video element
     */
    const validateVideo = (video) => {
        if (!video || !(video instanceof HTMLVideoElement)) {
            Logger.add('[STRATEGY:VALIDATE] Invalid video element', {
                type: typeof video,
                isElement: video instanceof HTMLElement
            });
            return false;
        }
        return true;
    };

    return {
        select: (video, options = {}) => {
            // Log what was requested
            Logger.add('[STRATEGY:SELECT] Strategy selection requested', {
                forceExperimental: !!options.forceExperimental,
                forceAggressive: !!options.forceAggressive,
                forceStandard: !!options.forceStandard
            });

            // DISABLED: Aggressive/Experimental - these destroy the player
            if (options.forceExperimental) {
                Logger.add('[STRATEGY:BLOCKED] ExperimentalRecovery requested but DISABLED', {
                    reason: 'Experimental recovery causes player destruction',
                    action: 'Using StandardRecovery instead'
                });
                // return ExperimentalRecovery; // DISABLED
                return StandardRecovery;
            }

            if (options.forceAggressive) {
                Logger.add('[STRATEGY:BLOCKED] AggressiveRecovery requested but DISABLED', {
                    reason: 'Aggressive recovery causes player destruction',
                    action: 'Using StandardRecovery instead'
                });
                // return AggressiveRecovery; // DISABLED
                return StandardRecovery;
            }

            if (!validateVideo(video)) {
                Logger.add('[STRATEGY:FALLBACK] Invalid video, using StandardRecovery');
                return StandardRecovery;
            }

            // Buffer analysis for logging purposes
            let analysis;
            try {
                analysis = BufferAnalyzer.analyze(video);
            } catch (error) {
                Logger.add('[STRATEGY:ERROR] BufferAnalyzer failed', {
                    error: String(error),
                    action: 'Using StandardRecovery'
                });
                return StandardRecovery;
            }

            Logger.add('[STRATEGY:SELECTED] StandardRecovery', {
                bufferHealth: analysis?.bufferHealth,
                bufferSize: analysis?.bufferSize?.toFixed(2),
                wouldHaveEscalated: analysis?.needsAggressive,
                reason: 'Aggressive strategies disabled'
            });

            return StandardRecovery;
        },

        /**
         * DISABLED: Escalation causes cascading failures
         * Now always returns null (no escalation)
         */
        getEscalation: (video, lastStrategy) => {
            // Log what would have happened
            let wouldEscalate = null;
            let reason = 'unknown';

            if (lastStrategy === StandardRecovery) {
                try {
                    const analysis = BufferAnalyzer.analyze(video);
                    if (analysis?.needsAggressive) {
                        wouldEscalate = 'AggressiveRecovery';
                        reason = 'Critical buffer state';
                    }
                } catch (e) {
                    reason = 'BufferAnalyzer error';
                }
            }

            Logger.add('[STRATEGY:ESCALATION] Escalation check (DISABLED)', {
                lastStrategy: lastStrategy?.name || 'unknown',
                wouldHaveEscalatedTo: wouldEscalate,
                reason: wouldEscalate ? reason : 'No escalation needed',
                action: 'BLOCKED - escalation causes player destruction',
                result: null
            });

            // DISABLED: Return null to prevent any escalation
            return null;
        }
    };
})();

