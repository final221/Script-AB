import { describe, it, expect, vi } from 'vitest';
import { createVideo } from '../helpers/video.js';

const createManager = () => {
    const monitorsById = new Map();
    const candidateSelector = {
        getActiveId: () => 'video-1',
        evaluateCandidates: vi.fn()
    };
    return window.RecoveryManager.create({
        monitorsById,
        candidateSelector,
        getVideoId: () => 'video-1',
        logDebug: () => {},
        onRescan: () => {},
        onPersistentFailure: () => {}
    });
};

describe('RecoveryManager refresh gating', () => {
    it('blocks refresh requests during cooldown', () => {
        const manager = createManager();
        const video = createVideo();
        const now = 100000;
        const monitorState = {
            lastRefreshAt: now - (CONFIG.stall.REFRESH_COOLDOWN_MS - 500)
        };

        const result = manager.canRequestRefresh(video, monitorState, { now, reason: 'manual' });

        expect(result.allow).toBe(false);
        expect(result.reason).toBe('cooldown');
        expect(result.remainingMs).toBeGreaterThan(0);
    });

    it('blocks no_source refresh when a source is still present', () => {
        const manager = createManager();
        const video = createVideo({ currentSrc: 'blob:https://www.twitch.tv/abc' });
        const now = 200000;
        const monitorState = {
            lastRefreshAt: now - CONFIG.stall.REFRESH_COOLDOWN_MS - 1
        };

        const result = manager.canRequestRefresh(video, monitorState, { now, reason: 'no_source' });

        expect(result.allow).toBe(false);
        expect(result.reason).toBe('no_source_not_ready');
    });
});
