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
        let activeProcessId = null;

        const getTiming = () => ({
            strictVerifyMs: CONFIG.stall.PROCESSING_ASSET_STRICT_VERIFY_MS || 600,
            probeWindowMs: CONFIG.stall.PROCESSING_ASSET_PROBE_WINDOW_MS || 1200,
            speculativeTimeoutMs: CONFIG.stall.PROCESSING_ASSET_SPECULATIVE_TIMEOUT_MS || 800
        });

        const sleep = (ms) => (
            Fn?.sleep
                ? Fn.sleep(ms)
                : new Promise((resolve) => setTimeout(resolve, ms))
        );

        const getActiveId = () => (
            typeof candidateSelector?.getActiveId === 'function'
                ? candidateSelector.getActiveId()
                : null
        );

        const getEntry = (videoId) => (
            videoId ? monitorsById.get(videoId) : null
        );

        const getState = (videoId) => getEntry(videoId)?.monitor?.state || null;

        const hasCandidateProgress = (videoId, baseline) => {
            const state = getState(videoId);
            if (!state || !state.hasProgress) return false;
            const progressTime = state.lastProgressTime || 0;
            return progressTime > (baseline || 0);
        };

        const getCandidateRecords = () => {
            const records = [];
            for (const [videoId, entry] of monitorsById.entries()) {
                const score = typeof candidateSelector?.scoreVideo === 'function'
                    ? candidateSelector.scoreVideo(entry.video, entry.monitor, videoId)
                    : null;
                const readyState = score?.vs?.readyState ?? entry.video?.readyState ?? 0;
                const src = score?.vs?.currentSrc
                    || score?.vs?.src
                    || entry.video?.currentSrc
                    || entry.video?.getAttribute?.('src')
                    || '';
                records.push({
                    id: videoId,
                    entry,
                    score: Number.isFinite(score?.score) ? score.score : Number.NEGATIVE_INFINITY,
                    deadCandidate: Boolean(score?.deadCandidate),
                    progressEligible: score?.progressEligible ?? false,
                    trusted: score?.trusted ?? null,
                    readyState,
                    hasSrc: Boolean(src),
                    strictEligible: Boolean(src) && readyState >= 2 && !score?.deadCandidate
                });
            }
            records.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return b.readyState - a.readyState;
            });
            return records;
        };

        const setActiveAndPlay = (processId, videoId, step) => {
            if (!videoId) {
                return { switched: false, played: false };
            }
            const entry = getEntry(videoId);
            if (!entry) {
                Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Candidate missing during processing asset recovery'), {
                    processId,
                    step,
                    videoId
                });
                return { switched: false, played: false };
            }
            const fromId = getActiveId();
            if (videoId !== fromId && typeof candidateSelector?.setActiveId === 'function') {
                candidateSelector.setActiveId(videoId);
            }
            const activeNow = getActiveId();
            const playPromise = entry.video?.play?.();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((err) => {
                    Logger.add(LogEvents.tagged('ASSET_HINT_PLAY', 'Play rejected'), {
                        processId,
                        step,
                        videoId,
                        error: err?.name,
                        message: err?.message
                    });
                });
            }
            return {
                switched: fromId !== activeNow,
                played: Boolean(playPromise),
                fromId,
                toId: activeNow
            };
        };

        return (signal = {}, helpers = {}) => {
            if (activeProcessId) {
                Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery already running'), {
                    activeProcessId
                });
                return true;
            }

            processCounter += 1;
            const processId = `asset-${processCounter}`;
            activeProcessId = processId;
            const truncateMessage = typeof helpers.truncateMessage === 'function'
                ? helpers.truncateMessage
                : (message) => String(message).substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN);
            const signalLevel = signal.level || 'unknown';
            const signalMessage = truncateMessage(signal.message || '');
            const activeBefore = getActiveId();
            const timing = getTiming();

            Logger.add(LogEvents.tagged('ASSET_HINT', 'Processing/offline asset recovery initiated'), {
                processId,
                level: signalLevel,
                message: signalMessage,
                activeVideoId: activeBefore,
                monitorCount: monitorsById?.size || 0,
                strictVerifyMs: timing.strictVerifyMs,
                probeWindowMs: timing.probeWindowMs,
                speculativeTimeoutMs: timing.speculativeTimeoutMs
            });

            Promise.resolve().then(async () => {
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Bypassing normal stall patience due to processing asset'), {
                    processId
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
                    return;
                }

                candidateSelector.evaluateCandidates('processing_asset');
                const candidates = getCandidateRecords();
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Candidate evaluation complete'), {
                    processId,
                    candidateCount: candidates.length,
                    strictEligibleCount: candidates.filter(c => c.strictEligible).length
                });

                const activeAtStrictStart = getActiveId();
                const strictCandidate = candidates.find((candidate) => (
                    candidate.strictEligible && candidate.id !== activeAtStrictStart
                ));

                if (strictCandidate) {
                    const strictBaseline = getState(strictCandidate.id)?.lastProgressTime || 0;
                    const strictSwitch = setActiveAndPlay(processId, strictCandidate.id, 'strict_pass');
                    Logger.add(LogEvents.tagged('ASSET_HINT', 'Strict candidate pass applied'), {
                        processId,
                        from: strictSwitch.fromId || null,
                        to: strictSwitch.toId || strictCandidate.id,
                        candidateScore: strictCandidate.score,
                        candidateReadyState: strictCandidate.readyState,
                        candidateHasSrc: strictCandidate.hasSrc,
                        switched: strictSwitch.switched
                    });
                    await sleep(timing.strictVerifyMs);
                    if (hasCandidateProgress(strictCandidate.id, strictBaseline)) {
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

                const activeAfterStrict = getActiveId();
                const probeTargets = candidates.filter(candidate => candidate.id !== activeAfterStrict);
                const probeBaselineById = new Map(
                    probeTargets.map((candidate) => [candidate.id, getState(candidate.id)?.lastProgressTime || 0])
                );
                const probeAttempts = probeTargets.map((candidate) => ({
                    videoId: candidate.id,
                    attempted: Boolean(recoveryManager.probeCandidate(candidate.id, 'processing_asset'))
                }));
                Logger.add(LogEvents.tagged('ASSET_HINT', 'Fast probe pass started'), {
                    processId,
                    probeWindowMs: timing.probeWindowMs,
                    activeVideoId: activeAfterStrict,
                    attempts: probeAttempts
                });
                await sleep(timing.probeWindowMs);
                const progressedProbeCandidate = probeTargets.find((candidate) => (
                    hasCandidateProgress(candidate.id, probeBaselineById.get(candidate.id))
                ));
                if (progressedProbeCandidate) {
                    const probeSwitch = setActiveAndPlay(processId, progressedProbeCandidate.id, 'probe_pass');
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

                const activeBeforeSpeculative = getActiveId();
                const speculativeCandidate = candidates.find(candidate => candidate.id !== activeBeforeSpeculative);
                if (speculativeCandidate) {
                    const speculativeBaseline = getState(speculativeCandidate.id)?.lastProgressTime || 0;
                    const speculativeSwitch = setActiveAndPlay(processId, speculativeCandidate.id, 'speculative_fallback');
                    Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback switch applied'), {
                        processId,
                        from: speculativeSwitch.fromId || null,
                        to: speculativeSwitch.toId || speculativeCandidate.id,
                        videoId: speculativeCandidate.id,
                        candidateScore: speculativeCandidate.score,
                        timeoutMs: timing.speculativeTimeoutMs
                    });
                    await sleep(timing.speculativeTimeoutMs);
                    if (hasCandidateProgress(speculativeCandidate.id, speculativeBaseline)) {
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
                    if (activeBeforeSpeculative
                        && activeBeforeSpeculative !== speculativeCandidate.id
                        && monitorsById.has(activeBeforeSpeculative)) {
                        const revertOutcome = setActiveAndPlay(processId, activeBeforeSpeculative, 'speculative_revert');
                        Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback reverted to previous active candidate'), {
                            processId,
                            from: revertOutcome.fromId || null,
                            to: revertOutcome.toId || activeBeforeSpeculative
                        });
                    }
                } else {
                    Logger.add(LogEvents.tagged('ASSET_HINT', 'Speculative fallback skipped (no alternate candidates)'), {
                        processId
                    });
                }

                const refreshId = getActiveId() || activeBefore;
                if (!refreshId) {
                    Logger.add(LogEvents.tagged('ASSET_HINT_SKIP', 'Processing asset recovery exhausted without refresh target'), {
                        processId
                    });
                    return;
                }
                const refreshState = getState(refreshId);
                const eligibility = recoveryManager.canRequestRefresh
                    ? recoveryManager.canRequestRefresh(refreshId, refreshState, {
                        reason: 'processing_asset_exhausted'
                    })
                    : { allow: true };
                const refreshed = eligibility.allow
                    ? recoveryManager.requestRefresh(refreshId, refreshState, {
                        reason: 'processing_asset_exhausted',
                        trigger: 'processing_asset',
                        detail: 'no_candidate_progress',
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
            }).catch((error) => {
                Logger.add(LogEvents.tagged('ERROR', 'Processing asset recovery process failed'), {
                    processId,
                    error: error?.name,
                    message: error?.message
                });
            }).finally(() => {
                if (activeProcessId === processId) {
                    activeProcessId = null;
                }
            });

            return true;
        };
    };

    return { create };
})();
