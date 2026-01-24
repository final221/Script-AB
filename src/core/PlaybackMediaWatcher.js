// --- PlaybackMediaWatcher ---
/**
 * Tracks media element property changes for watchdog logs.
 */
const PlaybackMediaWatcher = (() => {
    const create = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId;
        const state = options.state;
        const logDebug = options.logDebug || (() => {});

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
                logDebug(LogEvents.tagged('MEDIA_STATE', `${label} changed`), {
                    previous,
                    current,
                    videoState: snapshot
                });
                state.mediaStateVerboseLogged = true;
                return;
            }
            logDebug(LogEvents.tagged('MEDIA_STATE', `${label} changed ${formatMediaValue(previous)} -> ${formatMediaValue(current)}`));
        };

        const update = (now) => {
            const currentSrc = video.currentSrc || video.getAttribute('src') || '';
            if (currentSrc !== state.lastSrc) {
                logDebug(LogEvents.tagged('SRC', 'Source changed'), {
                    previous: VideoState.compactSrc(state.lastSrc),
                    current: VideoState.compactSrc(currentSrc),
                    videoState: VideoStateSnapshot.forLog(video, videoId)
                });
                state.lastSrc = currentSrc;
                state.lastSrcChangeTime = now;
            }

            const srcAttr = video.getAttribute ? (video.getAttribute('src') || '') : '';
            if (srcAttr !== state.lastSrcAttr) {
                logMediaStateChange(
                    'src attribute',
                    state.lastSrcAttr,
                    srcAttr,
                    VideoStateSnapshot.forLog(video, videoId, 'lite')
                );
                state.lastSrcAttr = srcAttr;
            }

            const readyState = video.readyState;
            if (readyState !== state.lastReadyState) {
                logMediaStateChange(
                    'readyState',
                    state.lastReadyState,
                    readyState,
                    VideoStateSnapshot.forLog(video, videoId, 'lite')
                );
                state.lastReadyState = readyState;
                state.lastReadyStateChangeTime = now;
            }

            const networkState = video.networkState;
            if (networkState !== state.lastNetworkState) {
                logMediaStateChange(
                    'networkState',
                    state.lastNetworkState,
                    networkState,
                    VideoStateSnapshot.forLog(video, videoId, 'lite')
                );
                state.lastNetworkState = networkState;
                state.lastNetworkStateChangeTime = now;
            }

            const hasSrc = Boolean(currentSrc || srcAttr);
            if (!hasSrc && readyState === 0) {
                if (!state.deadCandidateSince) {
                    state.deadCandidateSince = now;
                }
                if ((now - state.deadCandidateSince) >= CONFIG.monitoring.DEAD_CANDIDATE_AFTER_MS) {
                    state.deadCandidateUntil = now + CONFIG.monitoring.DEAD_CANDIDATE_COOLDOWN_MS;
                }
            } else if (state.deadCandidateSince || state.deadCandidateUntil) {
                state.deadCandidateSince = 0;
                state.deadCandidateUntil = 0;
            }

            let bufferedLength = 0;
            try {
                bufferedLength = video.buffered ? video.buffered.length : 0;
            } catch (error) {
                bufferedLength = state.lastBufferedLength;
            }
            if (bufferedLength !== state.lastBufferedLength) {
                logMediaStateChange(
                    'buffered range count',
                    state.lastBufferedLength,
                    bufferedLength,
                    VideoStateSnapshot.forLog(video, videoId, 'lite')
                );
                state.lastBufferedLength = bufferedLength;
                state.lastBufferedLengthChangeTime = now;
            }
        };

        return { update };
    };

    return { create };
})();
