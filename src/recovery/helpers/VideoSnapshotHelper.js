// --- Video Snapshot Helper ---
/**
 * Utilities for capturing and comparing video state.
 */
const VideoSnapshotHelper = (() => {
    /**
     * Captures a snapshot of current video element state.
     * @param {HTMLVideoElement} video - The video element to snapshot
     * @returns {Object} Snapshot containing readyState, networkState, currentTime, etc.
     */
    const captureVideoSnapshot = (video) => {
        return {
            readyState: video.readyState,
            networkState: video.networkState,
            currentTime: video.currentTime,
            paused: video.paused,
            error: video.error ? video.error.code : null,
            bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
        };
    };

    /**
     * Calculates the delta between pre and post recovery snapshots.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @returns {Object} Delta object showing what changed
     */
    const calculateRecoveryDelta = (preSnapshot, postSnapshot) => {
        return {
            readyStateChanged: preSnapshot.readyState !== postSnapshot.readyState,
            networkStateChanged: preSnapshot.networkState !== postSnapshot.networkState,
            currentTimeChanged: preSnapshot.currentTime !== postSnapshot.currentTime,
            pausedStateChanged: preSnapshot.paused !== postSnapshot.paused,
            errorCleared: preSnapshot.error && !postSnapshot.error,
            errorAppeared: !preSnapshot.error && postSnapshot.error,
            bufferIncreased: postSnapshot.bufferEnd > preSnapshot.bufferEnd
        };
    };

    return {
        captureVideoSnapshot,
        calculateRecoveryDelta
    };
})();
