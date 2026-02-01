// --- PlaybackWatchdog ---
/**
 * Watchdog interval that evaluates stalled playback state.
 */
const PlaybackWatchdog = (() => {
    const LOG = {
        WATCHDOG: LogEvents.TAG.WATCHDOG
    };

    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const transitions = options.transitions;
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
            let pauseFromStall = state.pauseFromStall || pausedAfterStall;
            if (video.paused && bufferExhausted && !pauseFromStall) {
                tracker.markStallEvent('watchdog_pause_buffer_exhausted');
                pauseFromStall = true;
            }
            if (video.paused && !pauseFromStall) {
                transitions.toPaused('watchdog_paused');
                return;
            }
            if (video.paused && pauseFromStall && state.state !== MonitorStates.STALLED) {
                transitions.toStalled(bufferExhausted ? 'paused_buffer_exhausted' : 'paused_after_stall');
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

            if (state.state !== MonitorStates.STALLED) {
                transitions.toStalled('watchdog_no_progress');
            }

            const logIntervalMs = Tuning.logIntervalMs(isActive());
            if (now - state.lastWatchdogLogTime > logIntervalMs) {
                state.lastWatchdogLogTime = now;
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
