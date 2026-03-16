// @module ExternalAssetRecoveryProcess
// @depends ExternalAssetRecoveryOps, RecoveryManager, LogEvents
const ExternalAssetRecoveryProcess = (() => {
    const run = async ({
        processId,
        signalLevel,
        signalMessage,
        activeBefore,
        helpers = {},
        monitorsById,
        candidateSelector,
        recoveryManager,
        onRescan
    }) => {
        const timing = ExternalAssetRecoveryOps.getTiming();
        Logger.add(LogEvents.tagged('ASSET_HINT', 'Bypassing normal stall patience due to processing asset'), { processId });
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
        onRescan('processing_asset', { level: signalLevel, message: signalMessage });
        if (recoveryManager.isFailoverActive()) {
            Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery skipped during failover'), {
                processId,
                reason: 'processing_asset',
                activeVideoId: activeBefore
            });
            return;
        }

        candidateSelector.evaluateCandidates('processing_asset');
        const candidates = ExternalAssetRecoveryOps.getCandidateRecords(monitorsById, candidateSelector);
        Logger.add(LogEvents.tagged('ASSET_HINT', 'Candidate evaluation complete'), {
            processId,
            candidateCount: candidates.length,
            strictEligibleCount: candidates.filter(c => c.strictEligible).length
        });

        const activeAtStrictStart = ExternalAssetRecoveryOps.getActiveId(candidateSelector);
        const strictCandidate = candidates.find((c) => c.strictEligible && c.id !== activeAtStrictStart);
        if (strictCandidate) {
            const strictBaseline = ExternalAssetRecoveryOps.captureCandidateBaseline(monitorsById, strictCandidate.id, Date.now());
            const strictSwitch = ExternalAssetRecoveryOps.setActiveAndPlay({
                processId,
                videoId: strictCandidate.id,
                step: 'strict_pass',
                candidateSelector,
                monitorsById
            });
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Strict candidate pass applied'), {
                processId,
                from: strictSwitch.fromId || null,
                to: strictSwitch.toId || strictCandidate.id,
                candidateScore: strictCandidate.score,
                candidateReadyState: strictCandidate.readyState,
                candidateHasSrc: strictCandidate.hasSrc,
                switched: strictSwitch.switched
            });
            await ExternalAssetRecoveryOps.sleep(timing.strictVerifyMs);
            if (ExternalAssetRecoveryOps.hasCandidateProgress(monitorsById, strictCandidate.id, strictBaseline)) {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Strict candidate verified progress, recovery completed'), {
                    processId,
                    videoId: strictCandidate.id
                });
                return;
            }
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Strict candidate did not progress within verify window'), {
                processId,
                videoId: strictCandidate.id,
                verifyWindowMs: timing.strictVerifyMs
            });
        } else {
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Strict candidate pass found no viable switch target'), {
                processId,
                activeVideoId: activeAtStrictStart
            });
        }

        if (recoveryManager.isFailoverActive()) {
            Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery aborted after strict pass due to failover'), {
                processId
            });
            return;
        }

        const activeAfterStrict = ExternalAssetRecoveryOps.getActiveId(candidateSelector);
        const probeTargets = candidates.filter(c => c.id !== activeAfterStrict);
        const probeBaselineById = new Map(
            probeTargets.map((c) => [c.id, ExternalAssetRecoveryOps.captureCandidateBaseline(monitorsById, c.id, Date.now())])
        );
        const probeAttempts = probeTargets.map((c) => ({
            videoId: c.id,
            attempted: Boolean(recoveryManager.probeCandidate(c.id, 'processing_asset'))
        }));
        Logger.add(LogEvents.tagged('ASSET_HINT', 'Fast probe pass started'), {
            processId,
            probeWindowMs: timing.probeWindowMs,
            activeVideoId: activeAfterStrict,
            attempts: probeAttempts
        });
        await ExternalAssetRecoveryOps.sleep(timing.probeWindowMs);
        const progressedProbeCandidate = probeTargets.find((c) => (
            ExternalAssetRecoveryOps.hasCandidateProgress(monitorsById, c.id, probeBaselineById.get(c.id))
        ));
        if (progressedProbeCandidate) {
            const probeSwitch = ExternalAssetRecoveryOps.setActiveAndPlay({
                processId,
                videoId: progressedProbeCandidate.id,
                step: 'probe_pass',
                candidateSelector,
                monitorsById
            });
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Fast probe pass found progressing candidate'), {
                processId,
                from: probeSwitch.fromId || null,
                to: probeSwitch.toId || progressedProbeCandidate.id,
                videoId: progressedProbeCandidate.id
            });
            return;
        }
        Logger.add(LogEvents.tagged('ASSET_HINT', 'Fast probe pass found no progressing candidates'), {
            processId,
            probeWindowMs: timing.probeWindowMs
        });

        const activeBeforeSpeculative = ExternalAssetRecoveryOps.getActiveId(candidateSelector);
        const speculativeCandidate = candidates.find(c => c.id !== activeBeforeSpeculative);
        if (speculativeCandidate) {
            const speculativeBaseline = ExternalAssetRecoveryOps.captureCandidateBaseline(monitorsById, speculativeCandidate.id, Date.now());
            const speculativeSwitch = ExternalAssetRecoveryOps.setActiveAndPlay({
                processId,
                videoId: speculativeCandidate.id,
                step: 'speculative_fallback',
                candidateSelector,
                monitorsById
            });
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback switch applied'), {
                processId,
                from: speculativeSwitch.fromId || null,
                to: speculativeSwitch.toId || speculativeCandidate.id,
                videoId: speculativeCandidate.id,
                candidateScore: speculativeCandidate.score,
                timeoutMs: timing.speculativeTimeoutMs
            });
            await ExternalAssetRecoveryOps.sleep(timing.speculativeTimeoutMs);
            if (ExternalAssetRecoveryOps.hasCandidateProgress(monitorsById, speculativeCandidate.id, speculativeBaseline)) {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback candidate progressed, recovery completed'), {
                    processId,
                    videoId: speculativeCandidate.id
                });
                return;
            }
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback candidate failed to progress, reverting'), {
                processId,
                videoId: speculativeCandidate.id
            });
            if (activeBeforeSpeculative && activeBeforeSpeculative !== speculativeCandidate.id && monitorsById.has(activeBeforeSpeculative)) {
                const revert = ExternalAssetRecoveryOps.setActiveAndPlay({
                    processId,
                    videoId: activeBeforeSpeculative,
                    step: 'speculative_revert',
                    candidateSelector,
                    monitorsById
                });
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback reverted to previous active candidate'), {
                    processId,
                    from: revert.fromId || null,
                    to: revert.toId || activeBeforeSpeculative
                });
            }
        } else {
            Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback skipped (no alternate candidates)'), {
                processId
            });
        }

        const refreshId = ExternalAssetRecoveryOps.getActiveId(candidateSelector) || activeBefore;
        if (!refreshId) {
            Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery exhausted without refresh target'), {
                processId
            });
            return;
        }
        const monitorState = ExternalAssetRecoveryOps.getState(monitorsById, refreshId);
        const eligibility = recoveryManager.canRequestRefresh
            ? recoveryManager.canRequestRefresh(refreshId, monitorState, { reason: 'processing_asset_exhausted' })
            : { allow: true };
        const refreshed = eligibility.allow
            ? recoveryManager.requestRefresh(refreshId, monitorState, {
                reason: 'processing_asset_exhausted',
                trigger: 'processing_asset',
                detail: 'no_candidate_progress',
                forcePageRefresh: true,
                eligibility
            })
            : false;
        Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing asset recovery exhausted, refresh decision applied'), {
            processId,
            videoId: refreshId || null,
            refreshEligible: eligibility.allow,
            refreshEligibilityReason: eligibility.reason || null,
            refreshed
        });
    };

    return { run };
})();
