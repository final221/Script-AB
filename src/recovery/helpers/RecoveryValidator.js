// --- Recovery Validator ---
/**
 * Validates recovery outcomes and pre-conditions.
 */
const RecoveryValidator = (() => {
    // Time progression tracking for health detection
    let lastHealthCheckTime = 0;
    let lastHealthCheckVideoTime = 0;
    const MIN_PROGRESSION_S = 0.3; // Video must advance at least 0.3s between checks
    const CHECK_WINDOW_MS = 2000; // Time window for progression check

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

        return {
            isValid: issues.length === 0,
            issues,
            hasImprovement
        };
    };

    /**
     * Checks if the video is already healthy enough to skip recovery.
     * Now includes time progression check to avoid false positives.
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if healthy (with verified time progression)
     */
    const detectAlreadyHealthy = (video) => {
        const now = Date.now();
        const currentVideoTime = video.currentTime;

        // Basic checks first
        const basicHealthy = (
            !video.paused &&
            video.readyState >= 3 &&
            !video.error &&
            video.networkState !== 3 // NETWORK_NO_SOURCE
        );

        if (!basicHealthy) {
            // Not healthy - reset tracking for next recovery attempt
            lastHealthCheckTime = now;
            lastHealthCheckVideoTime = currentVideoTime;
            return false;
        }

        // Time progression check: verify video is actually advancing
        const timeSinceLastCheck = now - lastHealthCheckTime;
        const videoTimeAdvancement = currentVideoTime - lastHealthCheckVideoTime;

        // Update tracking state
        lastHealthCheckTime = now;
        lastHealthCheckVideoTime = currentVideoTime;

        // Only skip if we have a recent check AND video time is advancing
        if (timeSinceLastCheck > 0 && timeSinceLastCheck < CHECK_WINDOW_MS) {
            if (videoTimeAdvancement < MIN_PROGRESSION_S) {
                Logger.add('[Resilience] Video appears healthy BUT time not advancing', {
                    videoTimeAdvancement: videoTimeAdvancement.toFixed(3),
                    minRequired: MIN_PROGRESSION_S,
                    readyState: video.readyState,
                    paused: video.paused
                });
                return false; // Video looks healthy but is actually stuck
            }
        }

        Logger.add('[Resilience] Video confirmed healthy - time is progressing', {
            videoTimeAdvancement: videoTimeAdvancement.toFixed(3),
            readyState: video.readyState,
            paused: video.paused
        });
        return true;
    };

    return {
        validateRecoverySuccess,
        detectAlreadyHealthy
    };
})();
