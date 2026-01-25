// --- ExternalSignalHandlerAsset ---
/**
 * Handles processing/offline asset signals.
 */
const ExternalSignalHandlerAsset = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const logDebug = options.logDebug || (() => {});
        const onRescan = options.onRescan || (() => {});

        return (signal = {}, helpers = {}) => {
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing/offline asset detected'), {
                level: signal.level || 'unknown',
                message: helpers.truncateMessage(signal.message || '')
            });

            if (candidateSelector && typeof candidateSelector.activateProbation === 'function') {
                candidateSelector.activateProbation('processing_asset');
            }

            helpers.logCandidateSnapshot(candidateSelector, monitorsById, 'processing_asset');
            onRescan('processing_asset', {
                level: signal.level || 'unknown',
                message: helpers.truncateMessage(signal.message || '')
            });

            if (recoveryManager.isFailoverActive()) {
                logDebug(LogEvents.tagged('ASSET_HINT_SKIP', 'Failover in progress'), {
                    reason: 'processing_asset'
                });
                return true;
            }

            const best = candidateSelector.evaluateCandidates('processing_asset');
            const switchOutcome = candidateSelector.forceSwitch(best, {
                reason: 'processing_asset',
                label: 'Forced switch after processing asset',
                suppressionLabel: 'Processing asset switch suppressed',
                requireSevere: true,
                requireProgressEligible: true
            });

            let activeId = switchOutcome.activeId;
            const activeIsStalled = switchOutcome.activeIsStalled;

            if (switchOutcome.suppressed && activeIsStalled && best?.id && best.id !== activeId) {
                recoveryManager.probeCandidate(best.id, 'processing_asset');
            }

            if (activeIsStalled
                && CONFIG.stall.PROCESSING_ASSET_LAST_RESORT_SWITCH
                && candidateSelector
                && typeof candidateSelector.selectEmergencyCandidate === 'function') {
                candidateSelector.selectEmergencyCandidate('processing_asset_last_resort', {
                    minReadyState: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_MIN_READY_STATE,
                    requireSrc: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC,
                    allowDead: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD,
                    label: 'Last-resort switch after processing asset'
                });
                activeId = candidateSelector.getActiveId();
            }

            if (activeIsStalled) {
                helpers.probeCandidates(recoveryManager, monitorsById, 'processing_asset', activeId);
            }

            const activeEntryForPlay = activeId ? monitorsById.get(activeId) : null;
            if (activeEntryForPlay) {
                const playPromise = activeEntryForPlay.video?.play?.();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((err) => {
                        Logger.add(LogEvents.tagged('ASSET_HINT_PLAY', 'Play rejected'), {
                            videoId: activeId,
                            error: err?.name,
                            message: err?.message
                        });
                    });
                }
            }
            return true;
        };
    };

    return { create };
})();
