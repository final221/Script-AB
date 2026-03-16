import { describe, it, expect } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackStateAliases', () => {
    it('builds legacy aliases from grouped playback state sections', () => {
        expect(window.PlaybackStateAliases.aliasMap.state).toEqual(['status', 'value']);
        expect(window.PlaybackStateAliases.aliasMap.lastRefreshAt).toEqual(['heal', 'lastRefreshAt']);
        expect(window.PlaybackStateAliases.aliasMap.bufferStarved).toEqual(['stall', 'bufferStarved']);
    });

    it('keeps alias-backed state mutations wired to grouped sections', () => {
        const state = window.PlaybackStateStore.create(createVideo());

        state.lastRefreshAt = 1234;
        state.bufferStarved = true;
        state.state = MonitorStates.STALLED;

        expect(state.heal.lastRefreshAt).toBe(1234);
        expect(state.stall.bufferStarved).toBe(true);
        expect(state.status.value).toBe(MonitorStates.STALLED);
    });
});
