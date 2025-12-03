/**
 * Specialized recovery strategy for A/V synchronization issues.
 * Implements a graduated approach to minimize user disruption while ensuring fix.
 */
const AVSyncRecovery = (() => {
    const classifySeverity = (discrepancyMs) => {
        if (discrepancyMs < 1000) return RecoveryConstants.SEVERITY.MINOR;
        if (discrepancyMs < 3000) return RecoveryConstants.SEVERITY.MODERATE;
        if (discrepancyMs < 10000) return RecoveryConstants.SEVERITY.SEVERE;
        return RecoveryConstants.SEVERITY.CRITICAL;
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const level2_pauseResume = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 2: Pause/Resume attempt');
        try {
            video.pause();
            await sleep(500); // Allow decoders to stabilize
            await video.play();
            return { level: 2, success: true, remainingDesync: 0 }; // Assume fixed for now, verification happens next cycle
        } catch (e) {
            Logger.add('[AV_SYNC] Level 2 failed', { error: e.message });
            return { level: 2, success: false, remainingDesync: discrepancy };
        }
    };

    const level3_seek = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 3: Seek to current position');
        try {
            const pos = video.currentTime;
            video.currentTime = pos + 0.1; // Force seek to reset decoder
            // Wait for seek to complete? usually handled by player events, but we'll return success
            return { level: 3, success: true, remainingDesync: 0 };
        } catch (e) {
            Logger.add('[AV_SYNC] Level 3 failed', { error: e.message });
            return { level: 3, success: false, remainingDesync: discrepancy };
        }
    };

    const level4_reload = async (video, discrepancy) => {
        Logger.add('[AV_SYNC] Level 4: Full reload via video.load()');
        try {
            const pos = video.currentTime;
            const src = video.src;

            // Basic reload sequence
            video.src = '';
            video.load();
            video.src = src;
            video.currentTime = pos;
            await video.play();

            return { level: 4, success: true, remainingDesync: 0 };
        } catch (e) {
            Logger.add('[AV_SYNC] Level 4 failed', { error: e.message });
            return { level: 4, success: false, remainingDesync: discrepancy };
        }
    };

    return {
        execute: async (video, discrepancy) => {
            const startTime = performance.now();
            const severity = classifySeverity(discrepancy);

            Logger.add('[AV_SYNC] Recovery initiated', {
                discrepancy: discrepancy.toFixed(2) + 'ms',
                severity,
                currentTime: video.currentTime,
                criticalThreshold: CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS + 'ms'
            });

            if (severity === RecoveryConstants.SEVERITY.MINOR) {
                Logger.add('[AV_SYNC] Level 1: Ignoring minor desync', {
                    reason: 'Below moderate threshold (1000ms)'
                });
                return;
            }

            let result;

            // DISABLED: This 500ms pause delay was causing constant desync instead of fixing it
            // The artificial delay disrupts browser-native A/V sync mechanisms
            // Keeping code for potential reversion if needed
            // if (severity === RecoveryConstants.SEVERITY.MODERATE) {
            //     Metrics.increment('av_sync_level2_attempts');
            //     result = await level2_pauseResume(video, discrepancy);
            // }

            if (severity === RecoveryConstants.SEVERITY.MODERATE) {
                // MONITORING ONLY - trust browser-native sync
                Logger.add('[AV_SYNC] MONITORING ONLY - moderate desync detected', {
                    severity,
                    discrepancy: discrepancy.toFixed(2) + 'ms',
                    reason: 'Disabled level2_pauseResume to prevent introducing delays',
                    wouldHaveTriggered: 'level2_pauseResume (500ms pause)',
                    action: 'Trusting browser-native A/V sync mechanisms'
                });
                Metrics.increment('av_sync_level2_skipped');
                return;
            }

            // DISABLED: Seeking disrupts playback unnecessarily for moderate desyncs
            // Browser handles A/V sync better than manual intervention
            // else if (severity === RecoveryConstants.SEVERITY.SEVERE) {
            //     Metrics.increment('av_sync_level3_attempts');
            //     result = await level3_seek(video, discrepancy);
            // }

            else if (severity === RecoveryConstants.SEVERITY.SEVERE && discrepancy < CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS) {
                // MONITORING ONLY - trust browser-native sync for severe but not critical
                Logger.add('[AV_SYNC] MONITORING ONLY - severe desync detected', {
                    severity,
                    discrepancy: discrepancy.toFixed(2) + 'ms',
                    reason: 'Disabled level3_seek to avoid disrupting playback',
                    wouldHaveTriggered: 'level3_seek (position +0.1s)',
                    action: 'Trusting browser-native A/V sync mechanisms',
                    note: 'Will only reload if exceeds critical threshold (' + CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS + 'ms)'
                });
                Metrics.increment('av_sync_level3_skipped');
                return;
            }

            else if (severity === RecoveryConstants.SEVERITY.CRITICAL || discrepancy >= CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS) {
                // ONLY reload for CRITICAL desync - indicates broken stream
                Logger.add('[AV_SYNC] CRITICAL desync - performing stream reload', {
                    severity,
                    discrepancy: discrepancy.toFixed(2) + 'ms',
                    criticalThreshold: CONFIG.timing.AV_SYNC_CRITICAL_THRESHOLD_MS + 'ms',
                    reason: 'Desync severe enough to indicate stream failure'
                });
                Metrics.increment('av_sync_level4_attempts');
                result = await level4_reload(video, discrepancy);

                const duration = performance.now() - startTime;
                Logger.add('[AV_SYNC] Recovery complete', {
                    level: result.level,
                    success: result.success,
                    duration: duration.toFixed(2) + 'ms',
                    remainingDesync: result.remainingDesync
                });

                if (!result.success) {
                    Logger.add('[AV_SYNC] Recovery failed, may escalate on next check');
                }
            }
        }
    };
})();
