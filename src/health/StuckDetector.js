// --- Stuck Detector ---
/**
 * Detects when video time is not advancing (stuck/frozen playback).
 * @responsibility Monitor video currentTime to detect stuck states.
 */
const StuckDetector = (() => {
    let state = {
        lastTime: 0,
        stuckCount: 0
    };

    const reset = (video = null) => {
        state.lastTime = video ? video.currentTime : 0;
        state.stuckCount = 0;
    };

    const check = (video) => {
        if (!video) return null;
        if (video.paused || video.ended) {
            if (CONFIG.debug && state.stuckCount > 0) {
                Logger.add('StuckDetector[Debug]: Stuck count reset due to paused/ended state.');
            }
            state.stuckCount = 0;
            state.lastTime = video.currentTime;
            return null;
        }

        const currentTime = video.currentTime;
        const lastTime = state.lastTime;
        const diff = Math.abs(currentTime - lastTime);

        if (CONFIG.debug) {
            Logger.add('StuckDetector[Debug]: Stuck check', {
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
            Logger.add('[HEALTH] Stuck threshold exceeded', {
                stuckCount: state.stuckCount,
                threshold: CONFIG.player.STUCK_COUNT_LIMIT,
                lastTime,
                currentTime
            });
            return {
                reason: 'Player stuck',
                details: { stuckCount: state.stuckCount, lastTime, currentTime, threshold: CONFIG.player.STUCK_COUNT_LIMIT }
            };
        }

        return null;
    };

    return {
        reset,
        check
    };
})();
