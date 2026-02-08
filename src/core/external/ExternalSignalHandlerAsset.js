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
        let processCounter = 0;

        return (signal = {}, helpers = {}) => {
            processCounter += 1;
            const processId = `asset-${processCounter}`;
            const truncateMessage = typeof helpers.truncateMessage === 'function'
                ? helpers.truncateMessage
                : (message) => String(message).substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN);
            const signalLevel = signal.level || 'unknown';
            const signalMessage = truncateMessage(signal.message || '');
            const activeBefore = typeof candidateSelector?.getActiveId === 'function'
                ? candidateSelector.getActiveId()
                : null;

            Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing/offline asset recovery initiated'), {
                processId,
                level: signalLevel,
                message: signalMessage,
                activeVideoId: activeBefore,
                monitorCount: monitorsById?.size || 0
            });

            if (candidateSelector && typeof candidateSelector.activateProbation === 'function') {
                candidateSelector.activateProbation('processing_asset');
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Probation activated for processing asset'), {
                    processId,
                    reason: 'processing_asset'
                });
            }

            if (typeof helpers.logCandidateSnapshot === 'function') {
                helpers.logCandidateSnapshot(candidateSelector, monitorsById, 'processing_asset');
            }
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Candidate snapshot captured and rescan requested'), {
                processId,
                reason: 'processing_asset'
            });
            onRescan('processing_asset', {
                level: signalLevel,
                message: signalMessage
            });

            if (recoveryManager.isFailoverActive()) {
                Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery skipped during failover'), {
                    processId,
                    reason: 'processing_asset',
                    activeVideoId: activeBefore
                });
                logDebug(LogEvents.tagged('ASSET_HINT_SKIP', 'Failover in progress'), {
                    reason: 'processing_asset',
                    processId
                });
                return true;
            }

            const best = candidateSelector.evaluateCandidates('processing_asset');
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Candidate evaluation complete'), {
                processId,
                reason: 'processing_asset',
                bestVideoId: best?.id || null,
                bestScore: Number.isFinite(best?.score) ? best.score : null,
                bestProgressEligible: best?.progressEligible ?? null,
                bestTrusted: best?.trusted ?? null
            });
            const switchOutcome = candidateSelector.forceSwitch(best, {
                reason: 'processing_asset',
                label: 'Forced switch after processing asset',
                suppressionLabel: 'Processing asset switch suppressed',
                requireSevere: true,
                requireProgressEligible: true
            });

            let activeId = switchOutcome?.activeId;
            if (!activeId && typeof candidateSelector.getActiveId === 'function') {
                activeId = candidateSelector.getActiveId();
            }
            const activeIsStalled = Boolean(switchOutcome?.activeIsStalled);

            Logger.add(LogEvents.tagged('ASSET_HINT', 'Forced switch decision applied'), {
                processId,
                switched: Boolean(switchOutcome?.switched),
                suppressed: Boolean(switchOutcome?.suppressed),
                activeVideoId: activeId || null,
                activeIsStalled,
                bestVideoId: best?.id || null
            });

            if (switchOutcome?.suppressed && activeIsStalled && best?.id && best.id !== activeId) {
                const attempted = recoveryManager.probeCandidate(best.id, 'processing_asset');
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Suppressed switch follow-up probe attempted'), {
                    processId,
                    targetVideoId: best.id,
                    attempted
                });
            }

            if (activeIsStalled
                && CONFIG.stall.PROCESSING_ASSET_LAST_RESORT_SWITCH
                && candidateSelector
                && typeof candidateSelector.selectEmergencyCandidate === 'function') {
                const beforeLastResort = activeId;
                const emergencyPick = candidateSelector.selectEmergencyCandidate('processing_asset_last_resort', {
                    minReadyState: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_MIN_READY_STATE,
                    requireSrc: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC,
                    allowDead: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD,
                    label: 'Last-resort switch after processing asset'
                });
                activeId = candidateSelector.getActiveId();
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Last-resort candidate decision evaluated'), {
                    processId,
                    switched: Boolean(emergencyPick),
                    from: beforeLastResort || null,
                    to: activeId || null,
                    allowDead: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_ALLOW_DEAD,
                    requireSrc: CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_REQUIRE_SRC
                });
            }

            if (activeIsStalled) {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Probe burst requested for stalled active candidate'), {
                    processId,
                    excludeVideoId: activeId || null
                });
                if (typeof helpers.probeCandidates === 'function') {
                    helpers.probeCandidates(recoveryManager, monitorsById, 'processing_asset', activeId);
                }
            }

            const activeEntryForPlay = activeId ? monitorsById.get(activeId) : null;
            if (activeEntryForPlay) {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Play attempt issued after processing asset recovery'), {
                    processId,
                    videoId: activeId
                });
                const playPromise = activeEntryForPlay.video?.play?.();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((err) => {
                        Logger.add(LogEvents.tagged('ASSET_HINT_PLAY', 'Play rejected'), {
                            processId,
                            videoId: activeId,
                            error: err?.name,
                            message: err?.message
                        });
                    });
                }
            } else {
                Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'No active candidate available for play attempt'), {
                    processId,
                    activeVideoId: activeId || null
                });
            }
            return true;
        };
    };

    return { create };
})();
