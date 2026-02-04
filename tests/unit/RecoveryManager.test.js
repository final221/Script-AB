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

    it('accepts videoId strings without calling getVideoId', () => {
        const monitorsById = new Map();
        const candidateSelector = {
            getActiveId: () => 'video-1',
            evaluateCandidates: vi.fn()
        };
        const getVideoId = () => {
            throw new Error('getVideoId should not be called');
        };
        const onPersistentFailure = vi.fn();
        const manager = window.RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId,
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure
        });

        const video = createVideo();
        const now = 300000;
        const monitorState = {
            lastRefreshAt: now - CONFIG.stall.REFRESH_COOLDOWN_MS - 1
        };
        monitorsById.set('video-1', { video, monitor: { state: monitorState } });

        const result = manager.requestRefresh('video-1', null, { now, reason: 'manual' });

        expect(result).toBe(true);
        expect(onPersistentFailure).toHaveBeenCalledTimes(1);
    });

    it('does not throw when requestRefresh is passed a videoId string from the registry', () => {
        const registry = window.MonitorRegistry.create();
        const monitorsById = new Map();
        const candidateSelector = {
            getActiveId: () => null,
            evaluateCandidates: vi.fn()
        };
        const onPersistentFailure = vi.fn();
        const manager = window.RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId: registry.getVideoId,
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure
        });

        const video = createVideo();
        const monitorState = { lastRefreshAt: 0 };
        monitorsById.set('video-1', { video, monitor: { state: monitorState } });

        expect(() => manager.requestRefresh('video-1', monitorState, { now: 100000, reason: 'manual' }))
            .not.toThrow();
    });

    it('requests refresh after repeated play-stuck errors on a single monitor', () => {
        vi.useFakeTimers();
        const now = 600000;
        vi.setSystemTime(now);

        const video = createVideo({ currentTime: 1, readyState: 3, currentSrc: 'blob:stream' }, [[0, 10]]);
        const monitorState = {
            playErrorCount: CONFIG.stall.PLAY_STUCK_REFRESH_AFTER - 1,
            lastPlayErrorTime: now
        };

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: monitorState } }]
        ]);
        const candidateSelector = {
            getActiveId: () => 'video-1',
            evaluateCandidates: vi.fn(),
            activateProbation: vi.fn()
        };
        const onPersistentFailure = vi.fn();

        const manager = window.RecoveryManager.create({
            monitorsById,
            candidateSelector,
            getVideoId: () => 'video-1',
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure
        });

        manager.handlePlayFailure(video, monitorState, {
            errorName: 'PLAY_STUCK',
            reason: 'play_error',
            error: 'play_stuck'
        });

        expect(onPersistentFailure).toHaveBeenCalled();
        expect(monitorState.lastRefreshAt).toBe(now);

        vi.useRealTimers();
    });
});
