// --- Recovery Validator ---
/**
 * Validates recovery outcomes and pre-conditions.
 */
const RecoveryValidator = (() => {
    // Time progression tracking for health detection
    let lastHealthCheckTime = 0;
    let lastHealthCheckVideoTime = 0;
    let lastFrameCount = 0; // NEW: Frame-based tracking
    const MIN_PROGRESSION_S = 0.3; // Video must advance at least 0.3s between checks
    const CHECK_WINDOW_MS = 2000; // Time window for progression check
    const MIN_FRAME_ADVANCEMENT = 5; // Minimum frames that should advance

    /**
     * Validates if recovery actually improved the state.
     * @param {Object} preSnapshot - Snapshot before recovery
     * @param {Object} postSnapshot - Snapshot after recovery
     * @param {Object} delta - Calculated changes
     * @returns {{isValid: boolean, issues: string[], hasImprovement: boolean}}
     */
    const validateRecoverySuccess = (preSnapshot, postSnapshot, delta) => {
        const issues = [];

        // Check 1: Ready state should not decrease
        if (delta.readyStateChanged && postSnapshot.readyState < preSnapshot.readyState) {
            issues.push(`readyState decreased: ${preSnapshot.readyState} → ${postSnapshot.readyState}`);
        }

        // Check 2: Error should not appear
        if (delta.errorAppeared) {
            issues.push(`MediaError appeared: code ${postSnapshot.error}`);
        }

        // Check 3: Should have some positive change
        const hasImprovement = (
            delta.errorCleared ||  // Error was fixed
            (delta.readyStateChanged && postSnapshot.readyState > preSnapshot.readyState) ||
            (postSnapshot.bufferEnd > preSnapshot.bufferEnd + 0.1) // Buffer increased
        );

        if (!hasImprovement && !delta.pausedStateChanged) {
            issues.push('No measurable improvement detected');
        }

        // Log validation result
        Logger.add('[RecoveryValidator] Validation complete', {
            isValid: issues.length === 0,
            hasImprovement,
            issueCount: issues.length,
            issues: issues.length > 0 ? issues : undefined
        });

        return {
            isValid: issues.length === 0,
            issues,
            hasImprovement
        };
    };

    /**
     * Checks if the video is already healthy enough to skip recovery.
     * Now includes frame progression check for more reliable detection.
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if healthy (with verified time/frame progression)
     */
    const detectAlreadyHealthy = (video) => {
        const now = Date.now();
        const currentVideoTime = video.currentTime;

        // Capture initial state for logging
        const state = {
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            error: video.error?.code || null,
            currentTime: currentVideoTime.toFixed(3)
        };

        // Basic checks first
        const basicHealthy = (
            !video.paused &&
            video.readyState >= 3 &&
            !video.error &&
            video.networkState !== 3 // NETWORK_NO_SOURCE
        );

        if (!basicHealthy) {
            Logger.add('[RecoveryValidator] Basic health check FAILED', {
                ...state,
                reason: video.paused ? 'paused' :
                    video.readyState < 3 ? 'readyState<3' :
                        video.error ? 'error' : 'networkState=NO_SOURCE'
            });
            lastHealthCheckTime = now;
            lastHealthCheckVideoTime = currentVideoTime;
            lastFrameCount = 0;
            return false;
        }

        // NEW: Frame progression check (more reliable than time)
        let frameAdvancement = 0;
        const quality = video.getVideoPlaybackQuality?.();
        if (quality) {
            const currentFrames = quality.totalVideoFrames;
            frameAdvancement = currentFrames - lastFrameCount;

            if (lastFrameCount > 0 && frameAdvancement < MIN_FRAME_ADVANCEMENT) {
                Logger.add('[RecoveryValidator] Frame progression FAILED', {
                    ...state,
                    frameAdvancement,
                    currentFrames,
                    lastFrameCount,
                    minRequired: MIN_FRAME_ADVANCEMENT
                });
                lastFrameCount = currentFrames;
                return false; // Frames stuck = actually not healthy
            }
            lastFrameCount = currentFrames;
        }

        // Time progression check as fallback
        const timeSinceLastCheck = now - lastHealthCheckTime;
        const videoTimeAdvancement = currentVideoTime - lastHealthCheckVideoTime;

        lastHealthCheckTime = now;
        lastHealthCheckVideoTime = currentVideoTime;

        if (timeSinceLastCheck > 0 && timeSinceLastCheck < CHECK_WINDOW_MS) {
            if (videoTimeAdvancement < MIN_PROGRESSION_S) {
                Logger.add('[RecoveryValidator] Time progression FAILED', {
                    ...state,
                    videoTimeAdvancement: videoTimeAdvancement.toFixed(3),
                    minRequired: MIN_PROGRESSION_S,
                    timeSinceLastCheck
                });
                return false;
            }
        }

        Logger.add('[RecoveryValidator] Health check PASSED', {
            ...state,
            videoTimeAdvancement: videoTimeAdvancement.toFixed(3),
            frameAdvancement: frameAdvancement || 'N/A (no quality API)'
        });
        return true;
    };

    return {
        validateRecoverySuccess,
        detectAlreadyHealthy
    };
})();

