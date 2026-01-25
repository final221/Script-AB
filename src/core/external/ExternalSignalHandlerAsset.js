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
            let activeId = candidateSelector.getActiveId();
            const activeEntry = activeId ? monitorsById.get(activeId) : null;
            const activeMonitorState = activeEntry ? activeEntry.monitor.state : null;
            const activeState = activeMonitorState ? activeMonitorState.state : null;
            const activeIsStalled = !activeEntry || ['STALLED', 'RESET', 'ERROR'].includes(activeState);
            const activeIsSevere = activeIsStalled
                && (activeState === 'RESET'
                    || activeState === 'ERROR'
                    || activeMonitorState?.bufferStarved);

            if (best && best.id && activeId && best.id !== activeId && best.progressEligible && activeIsSevere) {
                const fromId = activeId;
                activeId = best.id;
                candidateSelector.setActiveId(activeId);
                Logger.add(LogEvents.tagged('CANDIDATE', 'Forced switch after processing asset'), {
                    from: fromId,
                    to: activeId,
                    bestScore: best.score,
                    progressStreakMs: best.progressStreakMs,
                    progressEligible: best.progressEligible,
                    activeState,
                    bufferStarved: activeMonitorState?.bufferStarved || false
                });
            } else if (best && best.id && best.id !== activeId) {
                logDebug(LogEvents.tagged('CANDIDATE', 'Processing asset switch suppressed'), {
                    from: activeId,
                    to: best.id,
                    progressEligible: best.progressEligible,
                    activeState,
                    bufferStarved: activeMonitorState?.bufferStarved || false,
                    activeIsSevere
                });
                if (activeIsStalled) {
                    recoveryManager.probeCandidate(best.id, 'processing_asset');
                }
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
