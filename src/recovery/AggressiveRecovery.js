// --- Aggressive Recovery ---
/**
 * Stream refresh recovery strategy with escalating interventions.
 * @responsibility Force stream refresh when standard recovery fails.
 */
const AggressiveRecovery = (() => {
    const READY_CHECK_INTERVAL_MS = 100;

    /**
     * Attempts to toggle quality to force stream refresh
     * @param {HTMLVideoElement} video - The video element
     * @returns {boolean} True if quality toggle was attempted
     */
    const attemptQualityToggle = (video) => {
        try {
            // Find Twitch's React player instance
            const container = video.closest('.video-player');
            if (!container) return false;

            // Look for quality selector button
            const settingsBtn = container.querySelector('[data-a-target="player-settings-button"]');
            if (settingsBtn) {
                // Click settings to open menu
                settingsBtn.click();

                // Short delay then look for quality option
                setTimeout(() => {
                    const qualityBtn = container.querySelector('[data-a-target="player-settings-menu-item-quality"]');
                    if (qualityBtn) {
                        qualityBtn.click();
                        Logger.add('[Aggressive] Quality menu opened - user can select quality to refresh');
                    }
                    // Close menu after a moment
                    setTimeout(() => settingsBtn.click(), 500);
                }, 100);

                return true;
            }
        } catch (e) {
            Logger.add('[Aggressive] Quality toggle failed', { error: e.message });
        }
        return false;
    };

    return {
        name: 'AggressiveRecovery',

        execute: async (video) => {
            Metrics.increment('aggressive_recoveries');
            Logger.add('Executing aggressive recovery: escalating interventions');
            const recoveryStartTime = performance.now();

            // Log initial telemetry
            const initialState = RecoveryUtils.captureVideoState(video);
            const originalSrc = video.src;
            const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

            Logger.add('Aggressive recovery telemetry', {
                strategy: 'ESCALATING',
                url: originalSrc,
                isBlobUrl,
                telemetry: initialState
            });

            // Save video state
            const playbackRate = video.playbackRate;
            const volume = video.volume;
            const muted = video.muted;

            // STRATEGY 1: Pause/Resume cycle (can reset internal player state)
            Logger.add('[Aggressive] Strategy 1: Pause/Resume cycle');
            try {
                video.pause();
                await Fn.sleep(100);
                await video.play();
                await Fn.sleep(300);

                if (!video.paused && video.readyState >= 3) {
                    Logger.add('[Aggressive] Pause/Resume successful');
                    return;
                }
            } catch (e) {
                Logger.add('[Aggressive] Pause/Resume failed', { error: e.message });
            }

            // STRATEGY 2: Jump to buffer end (live edge)
            Logger.add('[Aggressive] Strategy 2: Jump to live edge');
            if (video.buffered.length > 0) {
                try {
                    const bufferEnd = video.buffered.end(video.buffered.length - 1);
                    // Jump to 0.5s before buffer end for safety margin
                    const target = Math.max(video.currentTime, bufferEnd - 0.5);

                    await new Promise((resolve) => {
                        const onSeeked = () => {
                            video.removeEventListener('seeked', onSeeked);
                            resolve();
                        };
                        const timeout = setTimeout(() => {
                            video.removeEventListener('seeked', onSeeked);
                            resolve();
                        }, 1000);
                        video.addEventListener('seeked', () => {
                            clearTimeout(timeout);
                            onSeeked();
                        }, { once: true });
                        video.currentTime = target;
                    });

                    await Fn.sleep(200);
                    if (!video.paused && video.readyState >= 3) {
                        Logger.add('[Aggressive] Jump to live edge successful', { target: target.toFixed(3) });
                        return;
                    }
                } catch (e) {
                    Logger.add('[Aggressive] Jump to live edge failed', { error: e.message });
                }
            }

            // STRATEGY 3: Attempt quality toggle (forces stream refresh)
            Logger.add('[Aggressive] Strategy 3: Quality toggle attempt');
            attemptQualityToggle(video);

            // Wait for stream to stabilize
            await RecoveryUtils.waitForStability(video, {
                startTime: recoveryStartTime,
                timeoutMs: CONFIG.timing.PLAYBACK_TIMEOUT_MS,
                checkIntervalMs: READY_CHECK_INTERVAL_MS
            });

            // Restore video state
            try {
                video.playbackRate = playbackRate;
                video.volume = volume;
                video.muted = muted;
            } catch (e) {
                Logger.add('Failed to restore video state', { error: e.message });
            }

            const duration = performance.now() - recoveryStartTime;
            Logger.add('[Aggressive] Recovery complete', {
                duration: duration.toFixed(0) + 'ms',
                finalState: RecoveryUtils.captureVideoState(video)
            });
        }
    };
})();
