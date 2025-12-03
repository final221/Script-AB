// --- Recovery Validator ---
/**
 * Validates recovery outcomes and pre-conditions.
 */
const RecoveryValidator = (() => {
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
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if healthy
     */
    const detectAlreadyHealthy = (video) => {
        return (
            !video.paused &&
            video.readyState >= 3 &&
            !video.error &&
            video.networkState !== 3 // NETWORK_NO_SOURCE
        );
    };

    return {
        validateRecoverySuccess,
        detectAlreadyHealthy
    };
})();
