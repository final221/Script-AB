import { describe, it, expect } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackStarvationLogic', () => {
    it('only marks starvation after the confirm window and clears on recovery', () => {
        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const logic = PlaybackStarvationLogic.create({
            state,
            logDebugLazy: () => {}
        });

        const lowBuffer = {
            bufferAhead: CONFIG.stall.BUFFER_STARVE_THRESHOLD_S - 0.1,
            hasBuffer: true
        };

        const baseTime = 1000;
        const notYetStarved = logic.updateBufferStarvation(lowBuffer, 'watchdog', baseTime);
        expect(notYetStarved).toBe(false);
        expect(state.bufferStarved).toBe(false);

        const stillNotStarved = logic.updateBufferStarvation(
            lowBuffer,
            'watchdog',
            baseTime + CONFIG.stall.BUFFER_STARVE_CONFIRM_MS - 1
        );
        expect(stillNotStarved).toBe(false);
        expect(state.bufferStarved).toBe(false);

        const nowStarved = logic.updateBufferStarvation(
            lowBuffer,
            'watchdog',
            baseTime + CONFIG.stall.BUFFER_STARVE_CONFIRM_MS + 1
        );
        expect(nowStarved).toBe(true);
        expect(state.bufferStarved).toBe(true);
        expect(state.bufferStarveUntil).toBeGreaterThan(0);

        const recovered = {
            bufferAhead: CONFIG.stall.BUFFER_STARVE_THRESHOLD_S + 0.5,
            hasBuffer: true
        };
        logic.updateBufferStarvation(
            recovered,
            'watchdog',
            baseTime + CONFIG.stall.BUFFER_STARVE_CONFIRM_MS + 2000
        );

        expect(state.bufferStarved).toBe(false);
        expect(state.bufferStarvedSince).toBe(0);
        expect(state.bufferStarveUntil).toBe(0);
    });
});
