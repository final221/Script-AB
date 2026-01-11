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

        const handleSignal = (signal = {}) => {
            if (!signal || monitorsById.size === 0) return;

            const type = signal.type || 'unknown';
            const level = signal.level || 'unknown';
            const message = signal.message || '';

            if (type === 'playhead_stall') {
                const active = getActiveEntry();
                if (!active) return;
                const now = Date.now();
                const state = active.entry.monitor.state;
                state.lastStallEventTime = now;
                state.pauseFromStall = true;

                Logger.add('[HEALER:STALL_HINT] Console playhead stall warning', {
                    videoId: active.id,
                    level,
                    message: message.substring(0, 300),
                    lastProgressAgoMs: state.lastProgressTime ? (now - state.lastProgressTime) : null,
                    videoState: VideoState.get(active.entry.video, active.id)
                });

                if (!state.hasProgress || !state.lastProgressTime) {
                    return;
                }

                const stalledForMs = now - state.lastProgressTime;
                if (stalledForMs >= CONFIG.stall.STALL_CONFIRM_MS) {
                    onStallDetected(active.entry.video, {
                        trigger: 'CONSOLE_STALL',
                        stalledFor: stalledForMs + 'ms',
                        bufferExhausted: BufferGapFinder.isBufferExhausted(active.entry.video),
                        paused: active.entry.video.paused,
                        pauseFromStall: true
                    }, state);
                }
                return;
            }

            if (type === 'processing_asset') {
                Logger.add('[HEALER:ASSET_HINT] Processing/offline asset detected', {
                    level,
                    message: message.substring(0, 300)
                });

                logCandidateSnapshot('processing_asset');
                onRescan('processing_asset', { level, message: message.substring(0, 300) });

                if (recoveryManager.isFailoverActive()) {
                    logDebug('[HEALER:ASSET_HINT_SKIP] Failover in progress', {
                        reason: 'processing_asset'
                    });
                    return;
                }

                const best = candidateSelector.evaluateCandidates('processing_asset');
                let activeId = candidateSelector.getActiveId();

                if (best && best.id && activeId && best.id !== activeId && best.progressEligible) {
                    const fromId = activeId;
                    activeId = best.id;
                    candidateSelector.setActiveId(activeId);
                    Logger.add('[HEALER:CANDIDATE] Forced switch after processing asset', {
                        from: fromId,
                        to: activeId,
                        bestScore: best.score,
                        progressStreakMs: best.progressStreakMs,
                        progressEligible: best.progressEligible
                    });
                }

                const activeEntry = activeId ? monitorsById.get(activeId) : null;
                if (activeEntry) {
                    const playPromise = activeEntry.video?.play?.();
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

            Logger.add('[HEALER:EXTERNAL] Unhandled external signal', {
                type,
                level,
                message: message.substring(0, 300)
            });
        };

        return { handleSignal };
    };

    return { create };
})();
