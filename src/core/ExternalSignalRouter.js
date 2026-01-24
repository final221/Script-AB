// --- ExternalSignalRouter ---
/**
 * Handles console-based external signal hints for recovery actions.
 */
const ExternalSignalRouter = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const candidateSelector = options.candidateSelector;
        const recoveryManager = options.recoveryManager;
        const logDebug = options.logDebug || (() => {});
        const onStallDetected = options.onStallDetected || (() => {});
        const onRescan = options.onRescan || (() => {});
        const playheadAttribution = PlayheadAttribution.create({
            monitorsById,
            candidateSelector,
            matchWindowSeconds: 2
        });

        const formatSeconds = (value) => (
            Number.isFinite(value) ? Number(value.toFixed(3)) : null
        );
        const truncateMessage = (message) => (
            String(message).substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN)
        );

        const getActiveEntry = () => {
            const activeId = candidateSelector.getActiveId();
            if (activeId && monitorsById.has(activeId)) {
                return { id: activeId, entry: monitorsById.get(activeId) };
            }
            const first = monitorsById.entries().next();
            if (!first.done) {
                return { id: first.value[0], entry: first.value[1] };
            }
            return null;
        };

        const logCandidateSnapshot = (reason) => {
            const candidates = [];
            for (const [videoId, entry] of monitorsById.entries()) {
                const score = candidateSelector.scoreVideo(entry.video, entry.monitor, videoId);
                candidates.push({
                    videoId,
                    score: score.score,
                    progressEligible: score.progressEligible,
                    progressStreakMs: score.progressStreakMs,
                    progressAgoMs: score.progressAgoMs,
                    readyState: score.vs.readyState,
                    bufferedLength: score.vs.bufferedLength,
                    paused: score.vs.paused,
                    currentSrc: score.vs.currentSrc,
                    reasons: score.reasons
                });
            }
            Logger.add('[HEALER:CANDIDATE_SNAPSHOT] Candidates scored', {
                reason,
                candidates
            });
        };

        const probeCandidates = (reason, excludeId = null) => {
            if (!recoveryManager || typeof recoveryManager.probeCandidate !== 'function') {
                return;
            }
            const attempts = [];
            let attemptedCount = 0;
            for (const [videoId] of monitorsById.entries()) {
                if (videoId === excludeId) continue;
                const attempted = recoveryManager.probeCandidate(videoId, reason);
                attempts.push({ videoId, attempted });
                if (attempted) attemptedCount += 1;
            }
            Logger.add('[HEALER:PROBE_BURST] Probing candidates', {
                reason,
                excludeId,
                attemptedCount,
                attempts
            });
        };

        const handleSignal = (signal = {}) => {
            if (!signal || monitorsById.size === 0) return;

            const type = signal.type || 'unknown';
            const level = signal.level || 'unknown';
            const message = signal.message || '';
            const url = signal.url || null;

            if (type === 'playhead_stall') {
                const attribution = playheadAttribution.resolve(signal.playheadSeconds);
                if (!attribution.id) {
                    Logger.add('[HEALER:STALL_HINT_UNATTRIBUTED] Console playhead stall warning', {
                        level,
                        message: truncateMessage(message),
                        playheadSeconds: attribution.playheadSeconds,
                        bufferEndSeconds: formatSeconds(signal.bufferEndSeconds),
                        activeVideoId: attribution.activeId,
                        reason: attribution.reason,
                        candidates: attribution.candidates
                    });
                    return;
                }
                const active = getActiveEntry();
                const entry = monitorsById.get(attribution.id);
                if (!entry) return;
                const now = Date.now();
                const state = entry.monitor.state;
                state.lastStallEventTime = now;
                state.pauseFromStall = true;

                Logger.add('[HEALER:STALL_HINT] Console playhead stall warning', {
                    videoId: attribution.id,
                    level,
                    message: truncateMessage(message),
                    playheadSeconds: attribution.playheadSeconds,
                    bufferEndSeconds: formatSeconds(signal.bufferEndSeconds),
                    attribution: attribution.reason,
                    activeVideoId: active ? active.id : null,
                    deltaSeconds: attribution.match ? attribution.match.deltaSeconds : null,
                    lastProgressAgoMs: state.lastProgressTime ? (now - state.lastProgressTime) : null,
                    videoState: VideoState.get(entry.video, attribution.id)
                });

                AdGapSignals.maybeLog({
                    video: entry.video,
                    videoId: attribution.id,
                    playheadSeconds: attribution.playheadSeconds,
                    monitorState: state,
                    now,
                    reason: 'console_stall'
                });

                if (!state.hasProgress || !state.lastProgressTime) {
                    return;
                }

                const stalledForMs = now - state.lastProgressTime;
                if (stalledForMs >= CONFIG.stall.STALL_CONFIRM_MS) {
                    onStallDetected(entry.video, {
                        trigger: 'CONSOLE_STALL',
                        stalledFor: stalledForMs + 'ms',
                        bufferExhausted: BufferGapFinder.isBufferExhausted(entry.video),
                        paused: entry.video.paused,
                        pauseFromStall: true
                    }, state);
                }
                return;
            }

            if (type === 'processing_asset') {
                Logger.add('[HEALER:ASSET_HINT] Processing/offline asset detected', {
                    level,
                    message: truncateMessage(message)
                });

                if (candidateSelector && typeof candidateSelector.activateProbation === 'function') {
                    candidateSelector.activateProbation('processing_asset');
                }

                logCandidateSnapshot('processing_asset');
                onRescan('processing_asset', { level, message: truncateMessage(message) });

                if (recoveryManager.isFailoverActive()) {
                    logDebug('[HEALER:ASSET_HINT_SKIP] Failover in progress', {
                        reason: 'processing_asset'
                    });
                    return;
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
                    Logger.add('[HEALER:CANDIDATE] Forced switch after processing asset', {
                        from: fromId,
                        to: activeId,
                        bestScore: best.score,
                        progressStreakMs: best.progressStreakMs,
                        progressEligible: best.progressEligible,
                        activeState,
                        bufferStarved: activeMonitorState?.bufferStarved || false
                    });
                } else if (best && best.id && best.id !== activeId) {
                    logDebug('[HEALER:CANDIDATE] Processing asset switch suppressed', {
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
                    probeCandidates('processing_asset', activeId);
                }

                const activeEntryForPlay = activeId ? monitorsById.get(activeId) : null;
                if (activeEntryForPlay) {
                    const playPromise = activeEntryForPlay.video?.play?.();
                    if (playPromise && typeof playPromise.catch === 'function') {
                        playPromise.catch((err) => {
                            Logger.add('[HEALER:ASSET_HINT_PLAY] Play rejected', {
                                videoId: activeId,
                                error: err?.name,
                                message: err?.message
                            });
                        });
                    }
                }
                return;
            }

            if (type === 'adblock_block') {
                Logger.add('[HEALER:ADBLOCK_HINT] Ad-block signal observed', {
                    type,
                    level,
                    message: truncateMessage(message),
                    url: url ? truncateMessage(url) : null
                });
                return;
            }

            Logger.add('[HEALER:EXTERNAL] Unhandled external signal', {
                type,
                level,
                message: truncateMessage(message)
            });
        };

        return { handleSignal };
    };

    return { create };
})();


