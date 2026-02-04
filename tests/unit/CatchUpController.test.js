import { describe, it, expect, vi, afterEach } from 'vitest';
import { setBufferedRanges } from '../helpers/video.js';

describe('CatchUpController', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('seeks toward live edge when stable and behind', () => {
        vi.useFakeTimers();
        const baseTime = new Date('2026-02-01T00:00:00Z');
        vi.setSystemTime(baseTime);

        const video = document.createElement('video');
        Object.defineProperty(video, 'currentTime', { value: 90, writable: true, configurable: true });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(video, 'currentSrc', { value: 'blob:stream', configurable: true });
        setBufferedRanges(video, [[0, 100]]);
        document.body.appendChild(video);

        const monitorState = {
            progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS + 1,
            lastStallEventTime: baseTime.getTime() - (CONFIG.recovery.CATCH_UP_STABLE_MS + 1),
            catchUpTimeoutId: null,
            catchUpAttempts: 0
        };

        const controller = window.CatchUpController.create();
        controller.scheduleCatchUp(video, monitorState, 'video-1', 'post_heal');

        vi.advanceTimersByTime(CONFIG.recovery.CATCH_UP_DELAY_MS + 1);

        expect(video.currentTime).toBeGreaterThan(90);
        expect(monitorState.lastCatchUpTime).toBeGreaterThan(baseTime.getTime());
        expect(monitorState.catchUpTimeoutId).toBeNull();

        video.remove();
    });
});
