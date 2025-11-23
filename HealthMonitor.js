// --- Health Monitor ---
/**
 * Monitors video playback health to detect "stuck" states caused by ad injection.
 * @responsibility Detects when the player is technically "playing" but time is not advancing.
 * Also monitors audio/video synchronization issues.
 */
const HealthMonitor = (() => {
    let state = {};
    const timers = { main: null, sync: null };

    const resetState = (video = null) => {
        state = {
            videoRef: video,
            lastTime: video ? video.currentTime : 0,
            stuckCount: 0,
            lastDroppedFrames: 0,
            lastTotalFrames: 0,
            lastSyncCheckTime: 0,
            lastSyncVideoTime: video ? video.currentTime : 0,
            syncIssueCount: 0,
        };
    };

    const triggerRecovery = (reason, details) => {
        Logger.add(`HealthMonitor triggering recovery: ${reason}`, details);
        Metrics.increment('health_triggers');
        HealthMonitor.stop();
        Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
    };

    const checkStuckState = () => {
        if (!state.videoRef) return;
        if (state.videoRef.paused || state.videoRef.ended) {
            if (CONFIG.debug && state.stuckCount > 0) {
                Logger.add('HealthMonitor[Debug]: Stuck count reset due to paused/ended state.');
            }
            state.stuckCount = 0;
            state.lastTime = state.videoRef.currentTime;
            return;
        }

        const currentTime = state.videoRef.currentTime;
        const lastTime = state.lastTime;
        const diff = Math.abs(currentTime - lastTime);

        if (CONFIG.debug) {
            Logger.add('HealthMonitor[Debug]: Stuck check', {
                currentTime: currentTime.toFixed(3),
                lastTime: lastTime.toFixed(3),
                diff: diff.toFixed(3),
                stuckCount: state.stuckCount,
                threshold: CONFIG.player.STUCK_THRESHOLD_S,
            });
        }

        if (diff < CONFIG.player.STUCK_THRESHOLD_S) {
            state.stuckCount++;
        } else {
            state.stuckCount = 0;
            state.lastTime = currentTime;
        }
        if (state.stuckCount >= CONFIG.player.STUCK_COUNT_LIMIT) {
            triggerRecovery('Player stuck', { stuckCount: state.stuckCount, lastTime, currentTime });
        }
    };

    const checkDroppedFrames = () => {
        if (!state.videoRef || !state.videoRef.getVideoPlaybackQuality) return;

        const quality = state.videoRef.getVideoPlaybackQuality();
        const newDropped = quality.droppedVideoFrames - state.lastDroppedFrames;
        const newTotal = quality.totalVideoFrames - state.lastTotalFrames;

        if (CONFIG.debug) {
            Logger.add('HealthMonitor[Debug]: Frame check', {
                dropped: quality.droppedVideoFrames,
                total: quality.totalVideoFrames,
                lastDropped: state.lastDroppedFrames,
                lastTotal: state.lastTotalFrames,
                newDropped,
                newTotal,
            });
        }

        if (newDropped > 0) {
            const recentDropRate = newTotal > 0 ? (newDropped / newTotal) * 100 : 0;
            Logger.add('Frame drop detected', { newDropped, newTotal, recentDropRate: recentDropRate.toFixed(2) + '%' });

            if (newDropped > CONFIG.timing.FRAME_DROP_SEVERE_THRESHOLD || (newDropped > CONFIG.timing.FRAME_DROP_MODERATE_THRESHOLD && recentDropRate > CONFIG.timing.FRAME_DROP_RATE_THRESHOLD)) {
                triggerRecovery('Severe frame drop', { newDropped, newTotal, recentDropRate });
            }
        }
        state.lastDroppedFrames = quality.droppedVideoFrames;
        state.lastTotalFrames = quality.totalVideoFrames;
    };

    const checkAVSync = () => {
        if (!state.videoRef) return;
        if (state.videoRef.paused || state.videoRef.ended || state.videoRef.readyState < 2) {
            if (state.syncIssueCount > 0) {
                Logger.add('A/V sync recovered', { previousIssues: state.syncIssueCount });
                state.syncIssueCount = 0;
            }
            return;
        }

        const now = Date.now();
        if (state.lastSyncCheckTime > 0) {
            const elapsedRealTime = (now - state.lastSyncCheckTime) / 1000;
            const expectedTimeAdvancement = elapsedRealTime * state.videoRef.playbackRate;
            const actualTimeAdvancement = state.videoRef.currentTime - state.lastSyncVideoTime;
            const discrepancy = Math.abs(expectedTimeAdvancement - actualTimeAdvancement);

            if (discrepancy > CONFIG.timing.AV_SYNC_THRESHOLD_MS / 1000 && expectedTimeAdvancement > 0.1) {
                state.syncIssueCount++;
                Logger.add('A/V sync issue detected', {
                    discrepancy: (discrepancy * 1000).toFixed(2) + 'ms',
                    count: state.syncIssueCount,
                });
            } else if (discrepancy < CONFIG.timing.AV_SYNC_THRESHOLD_MS / 2000) {
                if (state.syncIssueCount > 0) {
                    Logger.add('A/V sync recovered', { previousIssues: state.syncIssueCount });
                    state.syncIssueCount = 0;
                }
            }

            if (state.syncIssueCount >= 3) {
                triggerRecovery('Persistent A/V sync issue', { syncIssueCount: state.syncIssueCount, discrepancy });
                return;
            }
        }
        state.lastSyncCheckTime = now;
        state.lastSyncVideoTime = state.videoRef.currentTime;
    };

    return {
        start: (container) => {
            const video = container.querySelector(CONFIG.selectors.VIDEO);
            if (!video) return;

            if (state.videoRef !== video) {
                HealthMonitor.stop();
                resetState(video);
            }

            if (!timers.main) {
                timers.main = setInterval(() => {
                    if (!state.videoRef || !document.body.contains(state.videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }
                    checkStuckState();
                    checkDroppedFrames();
                }, CONFIG.timing.HEALTH_CHECK_MS);
            }

            if (!timers.sync) {
                timers.sync = setInterval(() => {
                    if (!state.videoRef || !document.body.contains(state.videoRef)) {
                        HealthMonitor.stop();
                        return;
                    }
                    checkAVSync();
                }, CONFIG.timing.AV_SYNC_CHECK_INTERVAL_MS);
            }
        },
        stop: () => {
            clearInterval(timers.main);
            clearInterval(timers.sync);
            timers.main = null;
            timers.sync = null;
            resetState();
        },
    };
})();
