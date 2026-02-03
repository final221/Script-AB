import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackProgressReset', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears heal and play backoff state on progress', () => {
        vi.useFakeTimers();
        vi.setSystemTime(30000);

        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const reset = PlaybackProgressReset.create({
            state,
            logDebugLazy: () => {}
        });

        state.noHealPointCount = 2;
        state.nextHealAllowedTime = 35000;
        state.playErrorCount = 3;
        state.nextPlayHealAllowedTime = 36000;
        state.healPointRepeatCount = 2;

        reset.clearBackoffOnProgress('progress', 30000);
        reset.clearPlayBackoffOnProgress('progress', 30000);

        expect(state.noHealPointCount).toBe(0);
        expect(state.nextHealAllowedTime).toBe(0);
        expect(state.playErrorCount).toBe(0);
        expect(state.nextPlayHealAllowedTime).toBe(0);
        expect(state.healPointRepeatCount).toBe(0);
    });
});
