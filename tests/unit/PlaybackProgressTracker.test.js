import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackProgressTracker', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('resets streak after long progress gaps', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);

        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const tracker = PlaybackProgressTracker.create({
            state,
            logDebugLazy: () => {},
            getCurrentTime: () => video.currentTime
        });

        state.progressStartTime = 500;
        state.progressStreakMs = 500;
        state.progressEligible = true;

        const gap = CONFIG.monitoring.PROGRESS_STREAK_RESET_MS + 1;
        tracker.updateProgressStreak('test', 1000, gap);

        expect(state.progressStartTime).toBe(1000);
        expect(state.progressStreakMs).toBe(0);
        expect(state.progressEligible).toBe(false);
        expect(state.lastProgressTime).toBe(1000);
        expect(state.hasProgress).toBe(true);
    });

    it('marks candidates eligible after minimum progress duration', () => {
        vi.useFakeTimers();
        vi.setSystemTime(5000);

        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const tracker = PlaybackProgressTracker.create({
            state,
            logDebugLazy: () => {},
            getCurrentTime: () => video.currentTime,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS
        });

        tracker.updateProgressStreak('initial', 5000, null);
        tracker.updateProgressStreak(
            'followup',
            5000 + CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            100
        );

        expect(state.progressEligible).toBe(true);
        expect(state.progressStreakMs).toBeGreaterThanOrEqual(CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS);
    });
});
