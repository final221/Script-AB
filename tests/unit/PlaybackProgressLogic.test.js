import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackProgressLogic', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('skips stall handling during the initial progress grace window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);

        const video = createVideo({ readyState: 0, currentSrc: '' });
        const state = PlaybackStateStore.create(video);
        state.firstSeenTime = 9950;
        state.firstReadyTime = 0;
        state.hasProgress = false;

        const logic = PlaybackProgressLogic.create({
            video,
            videoId: 'video-1',
            state,
            logHelper: { buildStallDuration: () => ({}) },
            logDebugLazy: () => {},
            getCurrentTime: () => video.currentTime,
            clearResetPending: () => {},
            evaluateResetState: () => ({})
        });

        const shouldSkip = logic.shouldSkipUntilProgress();

        expect(shouldSkip).toBe(true);
        expect(state.initLogEmitted).toBe(true);
    });

    it('stops skipping after the initial grace window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(20000);

        const video = createVideo({ readyState: 0, currentSrc: '' });
        const state = PlaybackStateStore.create(video);
        state.firstSeenTime = 20000 - (CONFIG.stall.INIT_PROGRESS_GRACE_MS + 1);
        state.firstReadyTime = 0;
        state.hasProgress = false;

        const logic = PlaybackProgressLogic.create({
            video,
            videoId: 'video-1',
            state,
            logHelper: { buildStallDuration: () => ({}) },
            logDebugLazy: () => {},
            getCurrentTime: () => video.currentTime,
            clearResetPending: () => {},
            evaluateResetState: () => ({})
        });

        const shouldSkip = logic.shouldSkipUntilProgress();

        expect(shouldSkip).toBe(false);
        expect(state.initialProgressTimeoutLogged).toBe(true);
    });
});
