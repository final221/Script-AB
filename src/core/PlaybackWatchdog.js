// --- PlaybackWatchdog ---
/**
 * Watchdog interval that evaluates stalled playback state.
 */
const PlaybackWatchdog = (() => {
    const LOG = {
        WATCHDOG: '[HEALER:WATCHDOG]'
    };

    const create = (options) => {
        const video = options.video;
        const videoId = options.videoId;
        const logDebug = options.logDebug;
        const tracker = options.tracker;
        const state = options.state;
        const setState = options.setState;
        const isHealing = options.isHealing;
        const onRemoved = options.onRemoved || (() => {});
        const onStall = options.onStall || (() => {});

        let intervalId;

        const tick = () => {
            const now = Date.now();
            if (!document.contains(video)) {
                Logger.add('[HEALER:CLEANUP] Video removed from DOM', {
                    videoId
                });
                onRemoved();
                return;
            }

            if (isHealing()) {
                return;
            }

            const bufferExhausted = BufferGapFinder.isBufferExhausted(video);
            const pausedAfterStall = state.lastStallEventTime > 0
                && (now - state.lastStallEventTime) < CONFIG.stall.PAUSED_STALL_GRACE_MS;
            let pauseFromStall = state.pauseFromStall || pausedAfterStall;
            if (video.paused && bufferExhausted && !pauseFromStall) {
                tracker.markStallEvent('watchdog_pause_buffer_exhausted');
                pauseFromStall = true;
            }
            if (video.paused && !pauseFromStall) {
                setState('PAUSED', 'watchdog_paused');
                return;
            }
            if (video.paused && pauseFromStall && state.state !== 'STALLED') {
                setState('STALLED', bufferExhausted ? 'paused_buffer_exhausted' : 'paused_after_stall');
            }

            if (tracker.shouldSkipUntilProgress()) {
                return;
            }

            const currentSrc = video.currentSrc || video.getAttribute('src') || '';
            if (currentSrc !== state.lastSrc) {
                logDebug('[HEALER:SRC] Source changed', {
                    previous: state.lastSrc,
                    current: currentSrc,
                    videoState: VideoState.get(video, videoId)
                });
                state.lastSrc = currentSrc;
            }

            const stalledForMs = now - state.lastProgressTime;
            if (stalledForMs < CONFIG.stall.STALL_CONFIRM_MS) {
                return;
            }

            const confirmMs = bufferExhausted
                ? CONFIG.stall.STALL_CONFIRM_MS
                : CONFIG.stall.STALL_CONFIRM_MS + CONFIG.stall.STALL_CONFIRM_BUFFER_OK_MS;

            if (stalledForMs < confirmMs) {
                return;
            }

            if (state.state !== 'STALLED') {
                setState('STALLED', 'watchdog_no_progress');
            }

            if (now - state.lastWatchdogLogTime > 5000) {
                state.lastWatchdogLogTime = now;
                logDebug(`${LOG.WATCHDOG} No progress observed`, {
                    stalledForMs,
                    bufferExhausted,
                    state: state.state,
                    videoState: VideoState.get(video, videoId)
                });
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
