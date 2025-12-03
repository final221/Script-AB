// --- A/V Sync Detector ---
/**
 * Monitors audio/video synchronization to detect drift issues.
 * @responsibility Track time advancement vs real-world time to detect A/V sync problems.
 */
const AVSyncDetector = (() => {
    let state = {
        lastSyncCheckTime: 0,
        lastSyncVideoTime: 0,
        syncIssueCount: 0
    };

    const reset = (video = null) => {
        state.lastSyncCheckTime = 0;
        state.lastSyncVideoTime = video ? video.currentTime : 0;
        state.syncIssueCount = 0;
    };

    const check = (video) => {
        if (!video) return null;
        if (video.paused || video.ended || video.readyState < 2) {
            if (state.syncIssueCount > 0) {
                Logger.add('A/V sync recovered', { previousIssues: state.syncIssueCount });
                state.syncIssueCount = 0;
            }
            return null;
        }

        const now = Date.now();
        if (state.lastSyncCheckTime > 0) {
            const elapsedRealTime = (now - state.lastSyncCheckTime) / 1000;
            const expectedTimeAdvancement = elapsedRealTime * video.playbackRate;
            const actualTimeAdvancement = video.currentTime - state.lastSyncVideoTime;
            const discrepancy = Math.abs(expectedTimeAdvancement - actualTimeAdvancement);
            const discrepancyMs = discrepancy * 1000;

            // Extensive logging: Log every sync check for visibility
            if (discrepancy > CONFIG.timing.AV_SYNC_THRESHOLD_MS / 1000 && expectedTimeAdvancement > 0.1) {
                state.syncIssueCount++;
                Logger.add('[HEALTH] A/V sync issue detected', {
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    count: state.syncIssueCount,
                    detectionThreshold: CONFIG.timing.AV_SYNC_THRESHOLD_MS + 'ms',
                    recoveryThreshold: CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS + 'ms',
                    willTriggerRecovery: discrepancyMs >= CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS
                });
            } else if (discrepancy < CONFIG.timing.AV_SYNC_THRESHOLD_MS / 2000) {
                if (state.syncIssueCount > 0) {
                    Logger.add('[HEALTH] A/V sync recovered', {
                        previousIssues: state.syncIssueCount,
                        currentDiscrepancy: discrepancyMs.toFixed(2) + 'ms'
                    });
                    state.syncIssueCount = 0;
                }
            }

            // CHANGED: Only trigger recovery if discrepancy exceeds RECOVERY threshold (2000ms)
            // Previously triggered after 3 consecutive detections regardless of severity
            if (state.syncIssueCount >= 5 && discrepancyMs >= CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS) {
                let severity = 'minor';
                if (discrepancyMs >= 10000) severity = 'critical';
                else if (discrepancyMs >= 3000) severity = 'severe';
                else if (discrepancyMs >= 1000) severity = 'moderate';

                Logger.add('[HEALTH] A/V sync threshold exceeded - triggering recovery', {
                    syncIssueCount: state.syncIssueCount,
                    consecutiveThreshold: 5,
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    severity,
                    recoveryThreshold: CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS + 'ms'
                });
                state.lastSyncCheckTime = now;
                state.lastSyncVideoTime = video.currentTime;
                return {
                    reason: 'Persistent A/V sync issue',
                    details: {
                        syncIssueCount: state.syncIssueCount,
                        discrepancy: discrepancyMs,
                        threshold: 5,
                        severity
                    }
                };
            } else if (state.syncIssueCount >= 5 && discrepancyMs < CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS) {
                // Extensive logging: Show when we detect issues but DON'T trigger recovery
                Logger.add('[HEALTH] A/V sync issues detected but below recovery threshold - monitoring only', {
                    syncIssueCount: state.syncIssueCount,
                    discrepancy: discrepancyMs.toFixed(2) + 'ms',
                    recoveryThreshold: CONFIG.timing.AV_SYNC_RECOVERY_THRESHOLD_MS + 'ms',
                    reason: 'Trusting browser-native A/V sync for minor desyncs'
                });
                // Reset counter to avoid accumulation
                state.syncIssueCount = 0;
            }
        }
        state.lastSyncCheckTime = now;
        state.lastSyncVideoTime = video.currentTime;
        return null;
    };

    return {
        reset,
        check
    };
})();
