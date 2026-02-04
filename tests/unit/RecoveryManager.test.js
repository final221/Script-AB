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

    it('delays refresh until the no-heal refresh window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);

        const monitorsById = new Map();
        const candidateSelector = {
            getActiveId: () => 'video-1',
            evaluateCandidates: vi.fn(),
            selectEmergencyCandidate: vi.fn().mockReturnValue(null),
            setActiveId: vi.fn(),
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

        const video = createVideo({
            currentTime: 9.5,
            readyState: CONFIG.stall.NO_HEAL_POINT_REFRESH_MIN_READY_STATE,
            currentSrc: 'blob:https://www.twitch.tv/stream'
        }, [[0, 10]]);
        const monitorState = {
            noHealPointCount: CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS - 1,
            bufferStarved: false,
            lastRefreshAt: 0
        };

        monitorsById.set('video-1', { video, monitor: { state: monitorState } });

        manager.handleNoHealPoint(video, monitorState, 'no_heal_point');

        expect(onPersistentFailure).not.toHaveBeenCalled();
        expect(monitorState.lastRefreshAt || 0).toBe(0);

        vi.advanceTimersByTime(CONFIG.stall.NO_HEAL_POINT_REFRESH_DELAY_MS + 1);

        manager.handleNoHealPoint(video, monitorState, 'no_heal_point');

        expect(onPersistentFailure).toHaveBeenCalledTimes(1);
        expect(monitorState.lastRefreshAt).toBeGreaterThan(0);

        vi.useRealTimers();
    });
});
