// --- PlaybackWatchdog ---
/**
 * Watchdog interval that evaluates stalled playback state.
 */
const PlaybackWatchdog = (() => {
    const LOG = {
        WATCHDOG: LogEvents.TAG.WATCHDOG
    };
    const watchdogBucket = (stalledForMs) => {
        if (!Number.isFinite(stalledForMs) || stalledForMs <= 0) return 0;
        if (stalledForMs < 10000) return 1;
        if (stalledForMs < 30000) return 2;
        if (stalledForMs < 60000) return 3;
        if (stalledForMs < 120000) return 4;
        if (stalledForMs < 300000) return 5;
        if (stalledForMs < 600000) return 6;
        return 7;
    };

    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const stallMachine = options.stallMachine;
        const isHealing = options.isHealing;
        const isActive = options.isActive || (() => true);
        const onRemoved = options.onRemoved || (() => {});
        const onStall = options.onStall || (() => {});

        let intervalId;
        const logHelper = PlaybackLogHelper.create({ video, videoId, state });
        const mediaWatcher = PlaybackMediaWatcher.create({
            video,
            videoId,
            state,
            logDebug
        });

        const tick = () => {
            const now = Date.now();
            if (!document.contains(video)) {
                Logger.add(LogEvents.tagged('CLEANUP', 'Video removed from DOM'), {
                    videoId
                });
                onRemoved();
                return;
            }

            tracker.evaluateResetPending('watchdog');
            if (state.resetPendingAt) {
                return;
            }

            if (isHealing(videoId)) {
                return;
            }

            const bufferExhausted = MediaState.isBufferExhausted(video);
            const pausedAfterStall = state.lastStallEventTime > 0
                && (now - state.lastStallEventTime) < CONFIG.stall.PAUSED_STALL_GRACE_MS;
            const pauseDecision = stallMachine.handleWatchdogPause(bufferExhausted, pausedAfterStall);
            const pauseFromStall = pauseDecision.pauseFromStall;
            if (pauseDecision.shouldReturn) {
                return;
            }

            if (tracker.shouldSkipUntilProgress()) {
                return;
            }

            if (isActive()) {
                const bufferInfo = MediaState.bufferAhead(video);
                tracker.updateBufferStarvation(bufferInfo, 'watchdog');
            }

            mediaWatcher.update(now);

            tracker.logSyncStatus();

            const lastProgressTime = state.lastProgressTime || state.firstSeenTime || now;
            const stalledForMs = now - lastProgressTime;
            if (stalledForMs < CONFIG.stall.STALL_CONFIRM_MS) {
                return;
            }

            const confirmMs = Tuning.stallConfirmMs(bufferExhausted);

            if (stalledForMs < confirmMs) {
                return;
            }

            stallMachine.handleWatchdogNoProgress();

            const logIntervalMs = Tuning.logIntervalMs(isActive());
            const stalledBucket = watchdogBucket(stalledForMs);
            const snapshot = [
                state.state,
                video.paused ? 1 : 0,
                video.readyState ?? null,
                video.networkState ?? null,
                bufferExhausted ? 1 : 0,
                pauseFromStall ? 1 : 0
            ].join('|');
            const snapshotChanged = (
                state.lastWatchdogSnapshot !== snapshot
                || state.lastWatchdogStallBucket !== stalledBucket
            );
            const heartbeatMs = logIntervalMs * 6;
            const heartbeatDue = (now - state.lastWatchdogLogTime) >= heartbeatMs;
            const shouldLog = snapshotChanged || heartbeatDue;

            if (shouldLog && (now - state.lastWatchdogLogTime) > logIntervalMs) {
                state.lastWatchdogLogTime = now;
                state.lastWatchdogSnapshot = snapshot;
                state.lastWatchdogStallBucket = stalledBucket;
                const entry = logHelper.buildWatchdogNoProgress(stalledForMs, bufferExhausted, pauseFromStall);
                logDebug(entry.message, entry.detail);
            }

            onStall({
                trigger: 'WATCHDOG',
                stalledFor: stalledForMs + 'ms',
                bufferExhausted,
                paused: video.paused,
                pauseFromStall
            }, state);
        };

        const start = () => {
            intervalId = setInterval(tick, CONFIG.stall.WATCHDOG_INTERVAL_MS);
        };

        const stop = () => {
            if (intervalId !== undefined) {
                clearInterval(intervalId);
            }
        };

        return { start, stop };
    };

    return { create };
})();
