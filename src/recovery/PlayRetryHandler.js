// --- Play Retry Handler ---
/**
 * Handles video.play() with retry logic and exponential backoff.
 * @responsibility Ensure reliable playback resumption after recovery.
 */
const PlayRetryHandler = (() => {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 300;
    const PLAY_CONFIRMATION_TIMEOUT_MS = 2000; // Increased from dynamic

    /**
     * Validates if the video is in a playable state before attempting play()
     * @param {HTMLVideoElement} video
     * @returns {{isValid: boolean, issues: string[]}}
     */
    const validatePlayable = (video) => {
        const issues = [];

        if (video.readyState < 3) {
            issues.push(`readyState too low: ${video.readyState}`);
        }
        if (video.error) {
            issues.push(`MediaError code: ${video.error.code}`);
        }
        if (!video.isConnected) {
            issues.push('Video element detached from DOM');
        }
        if (video.seeking) {
            issues.push('Already seeking');
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    };

    /**
     * Waits for the video to actually start playing.
     * @param {HTMLVideoElement} video
     * @param {number} timeoutMs
     * @returns {Promise<boolean>}
     */
    const waitForPlaying = (video, timeoutMs = 1000) => {
        return new Promise((resolve) => {
            if (!video.paused && video.readyState >= 3) {
                resolve(true);
                return;
            }

            let resolved = false;
            const cleanup = () => {
                video.removeEventListener('playing', onPlaying);
                video.removeEventListener('pause', onPause);
            };

            const onPlaying = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(true);
                }
            };

            const onPause = () => {
                // If it pauses again immediately, we might fail this attempt,
                // but we let the timeout or the next check handle the final verdict.
            };

            video.addEventListener('playing', onPlaying);
            video.addEventListener('pause', onPause);

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve(false);
                }
            }, timeoutMs);
        });
    };

    return {
        retry: async (video, context = 'unknown') => {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                const playStartTime = performance.now();

                // Pre-flight validation
                const validation = validatePlayable(video);
                if (!validation.isValid) {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} blocked by validation`, {
                        context,
                        issues: validation.issues,
                        videoState: {
                            readyState: video.readyState,
                            paused: video.paused,
                            isConnected: video.isConnected
                        }
                    });

                    if (attempt < MAX_RETRIES) {
                        await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                    }
                    continue;
                }

                // Intelligent micro-seek strategy
                if (attempt > 1) {
                    const shouldSeek = (
                        video.readyState >= 3 &&
                        !video.seeking &&
                        video.buffered.length > 0
                    );

                    if (shouldSeek) {
                        const bufferEnd = video.buffered.end(video.buffered.length - 1);
                        const gap = bufferEnd - video.currentTime;

                        if (gap > 1) {
                            const target = Math.min(video.currentTime + 0.5, bufferEnd - 0.1);
                            Logger.add(`[RECOVERY] Seeking to skip stuck point: ${target.toFixed(3)}`, {
                                context,
                                gap: gap.toFixed(3),
                                rationale: 'Player has buffer but stuck at current position'
                            });
                            video.currentTime = target;
                        } else {
                            Logger.add(`[RECOVERY] Skipping seek - insufficient buffer gap: ${gap.toFixed(3)}`, {
                                context
                            });
                        }
                    } else {
                        Logger.add('[RECOVERY] Skipping seek - conditions not met', {
                            context,
                            readyState: video.readyState,
                            seeking: video.seeking,
                            hasBuffer: video.buffered.length > 0
                        });
                    }
                }

                try {
                    Logger.add(`Play attempt ${attempt}/${MAX_RETRIES} (${context})`, {
                        before: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime,
                            error: video.error ? video.error.code : null
                        },
                    });

                    await video.play();

                    // Wait for the 'playing' event to confirm success
                    const isPlaying = await waitForPlaying(video, PLAY_CONFIRMATION_TIMEOUT_MS);
                    await Fn.sleep(50); // Small buffer after event

                    if (isPlaying && !video.paused) {
                        Logger.add(`Play attempt ${attempt} SUCCESS`, {
                            context,
                            duration_ms: (performance.now() - playStartTime).toFixed(2)
                        });
                        return true;
                    }

                    Logger.add(`Play attempt ${attempt} FAILED: video still paused`, {
                        context,
                        duration_ms: (performance.now() - playStartTime).toFixed(2),
                        currentState: {
                            paused: video.paused,
                            readyState: video.readyState,
                            currentTime: video.currentTime
                        }
                    });
                } catch (error) {
                    Logger.add(`Play attempt ${attempt} threw error`, {
                        context,
                        errorName: error.name,
                        errorMessage: error.message,
                        errorCode: error.code || null,
                        duration_ms: (performance.now() - playStartTime).toFixed(2),
                        videoState: {
                            readyState: video.readyState,
                            paused: video.paused,
                            networkState: video.networkState,
                            error: video.error ? video.error.code : null
                        }
                    });

                    // Categorize errors
                    if (error.name === 'NotAllowedError') {
                        Logger.add('[PLAYBACK] Browser blocked autoplay - cannot recover', { context });
                        return false; // Fatal, cannot recover
                    }
                    if (error.name === 'NotSupportedError') {
                        Logger.add('[PLAYBACK] Source not supported - cannot recover', { context });
                        return false; // Fatal
                    }
                    if (error.name === 'AbortError') {
                        Logger.add('[PLAYBACK] Play interrupted - possible DOM manipulation, retry allowed', { context });
                        // Continue to next attempt
                    }
                }

                if (attempt < MAX_RETRIES) {
                    await Fn.sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1));
                }
            }

            // Diagnostic summary
            Logger.add('All play attempts exhausted - DIAGNOSTIC SUMMARY', {
                context,
                attempts: MAX_RETRIES,
                finalState: {
                    paused: video.paused,
                    readyState: video.readyState,
                    networkState: video.networkState,
                    error: video.error ? video.error.code : null,
                    currentTime: video.currentTime,
                    bufferEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
                },
                analysis: 'Player appears stuck - recommend aggressive recovery (stream refresh)'
            });

            return false;
        }
    };
})();
