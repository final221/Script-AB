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
        const setState = options.setState;
        const isHealing = options.isHealing;
        const isActive = options.isActive || (() => true);
        const onRemoved = options.onRemoved || (() => {});
        const onStall = options.onStall || (() => {});

        let intervalId;

        const formatMediaValue = (value) => {
            if (typeof value === 'string') {
                if (!value) return '""';
                const compacted = VideoState.compactSrc(value);
                const maxLen = 80;
                if (compacted.length > maxLen) {
                    return `"${compacted.slice(0, maxLen - 3)}..."`;
                }
                return `"${compacted}"`;
            }
            if (value === null) return 'null';
            if (value === undefined) return 'undefined';
            return value;
        };

        const logMediaStateChange = (label, previous, current, snapshot) => {
            if (!state.mediaStateVerboseLogged) {
                logDebug(`[HEALER:MEDIA_STATE] ${label} changed`, {
                    previous,
                    current,
                    videoState: snapshot
                });
                state.mediaStateVerboseLogged = true;
                return;
            }
            logDebug(`[HEALER:MEDIA_STATE] ${label} changed ${formatMediaValue(previous)} -> ${formatMediaValue(current)}`);
        };

        const tick = () => {
            const now = Date.now();
            if (!document.contains(video)) {
                Logger.add('[HEALER:CLEANUP] Video removed from DOM', {
                    videoId
                });
                onRemoved();
                return;
            }

            tracker.evaluateResetPending('watchdog');
            if (state.resetPendingAt) {
                return;
            }

            if (isHealing()) {
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
                setState('PAUSED', 'watchdog_paused');
                return;
            }
            if (video.paused && pauseFromStall && state.state !== 'STALLED') {
                setState('STALLED', bufferExhausted ? 'paused_buffer_exhausted' : 'paused_after_stall');
            }

            if (tracker.shouldSkipUntilProgress()) {
                return;
            }

            if (isActive()) {
                const bufferInfo = MediaState.bufferAhead(video);
                tracker.updateBufferStarvation(bufferInfo, 'watchdog');
            }

            const currentSrc = video.currentSrc || video.getAttribute('src') || '';
            if (currentSrc !== state.lastSrc) {
                logDebug('[HEALER:SRC] Source changed', {
                    previous: VideoState.compactSrc(state.lastSrc),
                    current: VideoState.compactSrc(currentSrc),
                    videoState: VideoState.getLog(video, videoId)
                });
                state.lastSrc = currentSrc;
                state.lastSrcChangeTime = now;
            }

            const srcAttr = video.getAttribute ? (video.getAttribute('src') || '') : '';
            if (srcAttr !== state.lastSrcAttr) {
                logMediaStateChange('src attribute', state.lastSrcAttr, srcAttr, VideoState.getLiteLog(video, videoId));
                state.lastSrcAttr = srcAttr;
            }

            const readyState = video.readyState;
            if (readyState !== state.lastReadyState) {
                logMediaStateChange('readyState', state.lastReadyState, readyState, VideoState.getLiteLog(video, videoId));
                state.lastReadyState = readyState;
                state.lastReadyStateChangeTime = now;
            }

            const networkState = video.networkState;
            if (networkState !== state.lastNetworkState) {
                logMediaStateChange('networkState', state.lastNetworkState, networkState, VideoState.getLiteLog(video, videoId));
                state.lastNetworkState = networkState;
                state.lastNetworkStateChangeTime = now;
            }

            let bufferedLength = 0;
            try {
                bufferedLength = video.buffered ? video.buffered.length : 0;
            } catch (error) {
                bufferedLength = state.lastBufferedLength;
            }
            if (bufferedLength !== state.lastBufferedLength) {
                logMediaStateChange('buffered range count', state.lastBufferedLength, bufferedLength, VideoState.getLiteLog(video, videoId));
                state.lastBufferedLength = bufferedLength;
                state.lastBufferedLengthChangeTime = now;
            }

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

            if (state.state !== 'STALLED') {
                setState('STALLED', 'watchdog_no_progress');
            }

            const logIntervalMs = Tuning.logIntervalMs(isActive());
            if (now - state.lastWatchdogLogTime > logIntervalMs) {
                state.lastWatchdogLogTime = now;
                const snapshot = StateSnapshot.full(video, videoId);
                const summary = LogEvents.summary.watchdogNoProgress({
                    videoId,
                    stalledForMs,
                    bufferExhausted,
                    state: state.state,
                    paused: video.paused,
                    pauseFromStall,
                    currentTime: snapshot?.currentTime ? Number(snapshot.currentTime) : null,
                    readyState: snapshot?.readyState,
                    networkState: snapshot?.networkState,
                    buffered: snapshot?.buffered
                });
                logDebug(summary, {
                    stalledForMs,
                    bufferExhausted,
                    state: state.state,
                    paused: video.paused,
                    pauseFromStall
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
