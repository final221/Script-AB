// --- Resilience ---
/**
 * Executes the ad-blocking / recovery logic.
 * @responsibility
 * 1. Capture current player state.
 * 2. Attempt to restore playback by seeking to the live edge or unpausing.
 * 3. When stuck at buffer end (currentTime ≈ bufferEnd), use aggressive recovery
 *    (video.src clearing) to force stream refresh and bypass blocked ad segments.
 * 4. Note: Aggressive recovery is only used when stuck at buffer end to avoid
 *    unnecessary WASM worker disruption.
 */
const Resilience = (() => {
    let isFixing = false;

    const playWithRetry = async (video, context = 'unknown') => {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const playStartTime = performance.now();
            try {
                Logger.add(`Play attempt ${attempt}/${maxRetries} (${context})`, {
                    before: { paused: video.paused, readyState: video.readyState, currentTime: video.currentTime },
                });
                await video.play();
                await Fn.sleep(50);
                if (!video.paused) {
                    Logger.add(`Play attempt ${attempt} SUCCESS`, { context, duration_ms: performance.now() - playStartTime });
                    return true;
                }
                Logger.add(`Play attempt ${attempt} FAILED: video still paused`, { context, duration_ms: performance.now() - playStartTime });
            } catch (error) {
                Logger.add(`Play attempt ${attempt} threw error`, { context, error: error.message, duration_ms: performance.now() - playStartTime });
                if (error.name === 'NotAllowedError') {
                    return false;
                }
            }
            if (attempt < maxRetries) {
                await Fn.sleep(300 * attempt);
            }
        }
        Logger.add('All play attempts exhausted.', { context });
        return false;
    };

    const aggressiveRecovery = async (video) => {
        Metrics.increment('aggressive_recoveries');
        Logger.add('Executing aggressive recovery: forcing stream refresh');
        const recoveryStartTime = performance.now();

        const playbackRate = video.playbackRate;
        const volume = video.volume;
        const muted = video.muted;
        const originalSrc = video.src;
        const isBlobUrl = originalSrc && originalSrc.startsWith('blob:');

        if (isBlobUrl) {
            Logger.add('Blob URL detected - performing unload/reload cycle.');
            video.src = '';
            video.load();
            await Fn.sleep(100);
            video.src = originalSrc;
            video.load();
        } else {
            video.src = '';
            video.load();
        }

        await new Promise(resolve => {
            const checkInterval = 100;
            const maxChecks = CONFIG.timing.PLAYBACK_TIMEOUT_MS / checkInterval;
            let checkCount = 0;
            const interval = setInterval(() => {
                if (video.readyState >= 2) {
                    clearInterval(interval);
                    Logger.add('Stream reloaded.', { duration_ms: performance.now() - recoveryStartTime });
                    resolve();
                } else if (++checkCount >= maxChecks) {
                    clearInterval(interval);
                    Logger.add('Stream reload timeout during aggressive recovery.');
                    resolve();
                }
            }, checkInterval);
        });

        video.playbackRate = playbackRate;
        video.volume = volume;
        video.muted = muted;
    };

    const standardRecovery = (video) => {
        Logger.add('Executing standard recovery: seeking');
        if (video.buffered.length > 0) {
            const bufferEnd = video.buffered.end(video.buffered.length - 1);
            video.currentTime = bufferEnd - 0.5;
        }
    };

    return {
        execute: async (container) => {
            if (isFixing) {
                Logger.add('Resilience already in progress, skipping');
                return;
            }
            isFixing = true;
            const startTime = performance.now();

            try {
                Logger.add('Resilience execution started');
                Metrics.increment('resilience_executions');
                const video = container.querySelector(CONFIG.selectors.VIDEO);
                if (!video) {
                    Logger.add('Resilience aborted: No video element found');
                    return;
                }

                const { currentTime, buffered, error } = video;
                if (error && error.code === CONFIG.codes.MEDIA_ERROR_SRC) {
                    Logger.add('Fatal error (code 4) - cannot recover, waiting for Twitch reload');
                    return;
                }

                let needsAggressive = false;
                if (buffered.length > 0) {
                    const bufferEnd = buffered.end(buffered.length - 1);
                    if (Math.abs(currentTime - bufferEnd) < 0.5) {
                        if ((bufferEnd - buffered.start(0)) < CONFIG.player.BUFFER_HEALTH_S) {
                            Logger.add('Insufficient buffer for recovery, waiting');
                            return;
                        }
                        needsAggressive = true;
                    }
                }

                if (needsAggressive) {
                    await aggressiveRecovery(video);
                } else {
                    standardRecovery(video);
                }

                if (video.paused) {
                    await playWithRetry(video, 'post-recovery');
                }

                Adapters.EventBus.emit(CONFIG.events.REPORT, { status: 'SUCCESS' });
            } catch (e) {
                Logger.add('Resilience failed', { error: String(e) });
            } finally {
                isFixing = false;
                Logger.add('Resilience execution finished', { total_duration_ms: performance.now() - startTime });
            }
        },
    };
})();
