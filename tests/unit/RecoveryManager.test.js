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
        const now = 200000;
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

    it('keeps refresh cooldown on the same video element after re-registration', () => {
        const monitorsById = new Map();
        const candidateSelector = {
            getActiveId: () => 'video-1',
            evaluateCandidates: vi.fn()
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

        const video = createVideo();
        const firstState = { lastRefreshAt: 0 };
        const secondState = { lastRefreshAt: 0 };
        monitorsById.set('video-1', { video, monitor: { state: firstState } });

        const refreshed = manager.requestRefresh('video-1', firstState, {
            now: 200000,
            reason: 'manual'
        });

        expect(refreshed).toBe(true);

        monitorsById.delete('video-1');
        monitorsById.set('video-2', { video, monitor: { state: secondState } });

        const result = manager.canRequestRefresh('video-2', secondState, {
            now: 200500,
            reason: 'manual'
        });

        expect(result.allow).toBe(false);
        expect(result.reason).toBe('cooldown');
        expect(result.remainingMs).toBeGreaterThan(0);
    });

    it('delays refresh until the no-heal refresh window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(200000);

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

    it('attempts failover even when an emergency switch was applied', () => {
        const originalRecoveryPolicyCreate = window.RecoveryPolicy.create;
        const originalFailoverManagerCreate = window.FailoverManager.create;
        const attemptFailover = vi.fn();
        const handleNoHealPoint = vi.fn(() => ({
            emergencySwitched: true,
            shouldFailover: true,
            refreshed: false
        }));

        window.RecoveryPolicy.create = vi.fn(() => ({
            resetBackoff: vi.fn(),
            resetPlayError: vi.fn(),
            handleNoHealPoint,
            handlePlayFailure: vi.fn(() => ({
                probationTriggered: false,
                repeatStuck: false,
                shouldFailover: false
            })),
            shouldSkipStall: vi.fn(() => false)
        }));
        window.FailoverManager.create = vi.fn(() => ({
            isActive: () => false,
            resetFailover: vi.fn(),
            attemptFailover,
            probeCandidate: vi.fn(),
            shouldIgnoreStall: () => false,
            onMonitorRemoved: vi.fn()
        }));

        try {
            const monitorsById = new Map();
            const candidateSelector = {
                getActiveId: () => 'video-1',
                evaluateCandidates: vi.fn()
            };
            const manager = window.RecoveryManager.create({
                monitorsById,
                candidateSelector,
                getVideoId: () => 'video-1',
                logDebug: () => {},
                onRescan: () => {},
                onPersistentFailure: () => {}
            });

            const video = createVideo();
            const monitorState = {};
            monitorsById.set('video-1', { video, monitor: { state: monitorState } });

            manager.handleNoHealPoint(video, monitorState, 'no_heal_point');

            expect(handleNoHealPoint).toHaveBeenCalled();
            expect(attemptFailover).toHaveBeenCalledWith('video-1', 'no_heal_point', monitorState);
        } finally {
            window.RecoveryPolicy.create = originalRecoveryPolicyCreate;
            window.FailoverManager.create = originalFailoverManagerCreate;
        }
    });

    it('does not refresh when failover starts for no-heal arbitration', () => {
        const originalRecoveryPolicyCreate = window.RecoveryPolicy.create;
        const originalFailoverManagerCreate = window.FailoverManager.create;
        const attemptFailover = vi.fn(() => true);
        const onPersistentFailure = vi.fn();
        const handleNoHealPoint = vi.fn(() => ({
            shouldFailover: true,
            failoverEligible: true,
            refreshEligible: true,
            action: 'failover'
        }));

        window.RecoveryPolicy.create = vi.fn(() => ({
            resetBackoff: vi.fn(),
            resetPlayError: vi.fn(),
            handleNoHealPoint,
            handlePlayFailure: vi.fn(() => ({
                probationTriggered: false,
                repeatStuck: false,
                shouldFailover: false
            })),
            shouldSkipStall: vi.fn(() => false)
        }));
        window.FailoverManager.create = vi.fn(() => ({
            isActive: () => false,
            resetFailover: vi.fn(),
            attemptFailover,
            probeCandidate: vi.fn(),
            shouldIgnoreStall: () => false,
            onMonitorRemoved: vi.fn()
        }));

        try {
            const monitorsById = new Map();
            const candidateSelector = {
                getActiveId: () => 'video-1',
                evaluateCandidates: vi.fn()
            };
            const manager = window.RecoveryManager.create({
                monitorsById,
                candidateSelector,
                getVideoId: () => 'video-1',
                logDebug: () => {},
                onRescan: () => {},
                onPersistentFailure
            });

            const video = createVideo({ currentSrc: 'blob:https://www.twitch.tv/stream' });
            const monitorState = { lastRefreshAt: 0, noHealPointCount: 3 };
            monitorsById.set('video-1', { video, monitor: { state: monitorState } });

            manager.handleNoHealPoint(video, monitorState, 'no_heal_point');

            expect(attemptFailover).toHaveBeenCalledWith('video-1', 'no_heal_point', monitorState);
            expect(onPersistentFailure).not.toHaveBeenCalled();
        } finally {
            window.RecoveryPolicy.create = originalRecoveryPolicyCreate;
            window.FailoverManager.create = originalFailoverManagerCreate;
        }
    });

    it('falls back to refresh when failover cannot start in no-heal arbitration', () => {
        const originalRecoveryPolicyCreate = window.RecoveryPolicy.create;
        const originalFailoverManagerCreate = window.FailoverManager.create;
        const attemptFailover = vi.fn(() => false);
        const onPersistentFailure = vi.fn();
        const handleNoHealPoint = vi.fn(() => ({
            shouldFailover: true,
            failoverEligible: true,
            refreshEligible: true,
            action: 'failover'
        }));

        window.RecoveryPolicy.create = vi.fn(() => ({
            resetBackoff: vi.fn(),
            resetPlayError: vi.fn(),
            handleNoHealPoint,
            handlePlayFailure: vi.fn(() => ({
                probationTriggered: false,
                repeatStuck: false,
                shouldFailover: false
            })),
            shouldSkipStall: vi.fn(() => false)
        }));
        window.FailoverManager.create = vi.fn(() => ({
            isActive: () => false,
            resetFailover: vi.fn(),
            attemptFailover,
            probeCandidate: vi.fn(),
            shouldIgnoreStall: () => false,
            onMonitorRemoved: vi.fn()
        }));

        try {
            const monitorsById = new Map();
            const candidateSelector = {
                getActiveId: () => 'video-1',
                evaluateCandidates: vi.fn()
            };
            const manager = window.RecoveryManager.create({
                monitorsById,
                candidateSelector,
                getVideoId: () => 'video-1',
                logDebug: () => {},
                onRescan: () => {},
                onPersistentFailure
            });

            const video = createVideo({ currentSrc: 'blob:https://www.twitch.tv/stream' });
            const monitorState = {
                lastRefreshAt: Date.now() - CONFIG.stall.REFRESH_COOLDOWN_MS - 1,
                noHealPointCount: 3
            };
            monitorsById.set('video-1', { video, monitor: { state: monitorState } });

            manager.handleNoHealPoint(video, monitorState, 'no_heal_point');

            expect(attemptFailover).toHaveBeenCalledWith('video-1', 'no_heal_point', monitorState);
            expect(onPersistentFailure).toHaveBeenCalledTimes(1);
            expect(onPersistentFailure.mock.calls[0][1]).toMatchObject({
                reason: 'no_heal_point',
                detail: 'no_heal_point'
            });
        } finally {
            window.RecoveryPolicy.create = originalRecoveryPolicyCreate;
            window.FailoverManager.create = originalFailoverManagerCreate;
        }
    });

    it('forces page refresh as last resort after persistent play-stuck when failover cannot start', () => {
        vi.useFakeTimers();
        vi.setSystemTime(500000);
        const originalRecoveryPolicyCreate = window.RecoveryPolicy.create;
        const originalFailoverManagerCreate = window.FailoverManager.create;
        const attemptFailover = vi.fn(() => false);
        const onPersistentFailure = vi.fn();

        window.RecoveryPolicy.create = vi.fn(() => ({
            resetBackoff: vi.fn(),
            resetPlayError: vi.fn(),
            handleNoHealPoint: vi.fn(() => ({
                shouldFailover: false,
                failoverEligible: false,
                refreshEligible: false,
                action: 'none'
            })),
            handlePlayFailure: vi.fn(() => ({
                probationTriggered: true,
                repeatStuck: true,
                shouldFailover: true
            })),
            shouldSkipStall: vi.fn(() => false)
        }));
        window.FailoverManager.create = vi.fn(() => ({
            isActive: () => false,
            resetFailover: vi.fn(),
            attemptFailover,
            probeCandidate: vi.fn(),
            shouldIgnoreStall: () => false,
            onMonitorRemoved: vi.fn()
        }));

        try {
            const monitorsById = new Map();
            const candidateSelector = {
                getActiveId: () => 'video-1',
                evaluateCandidates: vi.fn()
            };
            const manager = window.RecoveryManager.create({
                monitorsById,
                candidateSelector,
                getVideoId: () => 'video-1',
                logDebug: () => {},
                onRescan: () => {},
                onPersistentFailure
            });

            const video = createVideo({ currentSrc: 'blob:https://www.twitch.tv/stream' });
            const monitorState = {
                playErrorCount: CONFIG.stall.PLAY_STUCK_LAST_RESORT_PAGE_REFRESH_AFTER,
                lastProgressTime: Date.now() - CONFIG.stall.PLAY_STUCK_LAST_RESORT_MIN_STALL_MS - 1,
                lastRefreshAt: Date.now(),
                noHealPointCount: 0
            };
            monitorsById.set('video-1', { video, monitor: { state: monitorState } });

            manager.handlePlayFailure(video, monitorState, {
                reason: 'play_error',
                errorName: 'PLAY_STUCK',
                error: 'Play did not resume'
            });

            expect(attemptFailover).toHaveBeenCalledWith('video-1', 'play_error', monitorState);
            expect(onPersistentFailure).toHaveBeenCalledTimes(1);
            expect(onPersistentFailure).toHaveBeenCalledWith('video-1', expect.objectContaining({
                reason: 'play_stuck_last_resort',
                detail: 'persistent_play_stuck_no_failover',
                forcePageRefresh: true
            }));
        } finally {
            window.RecoveryPolicy.create = originalRecoveryPolicyCreate;
            window.FailoverManager.create = originalFailoverManagerCreate;
            vi.useRealTimers();
        }
    });

    it('applies a temporary hard-failure mode after processing-asset exhaustion refresh', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);
        const originalRecoveryPolicyCreate = window.RecoveryPolicy.create;
        const originalFailoverManagerCreate = window.FailoverManager.create;
        const handleNoHealPoint = vi.fn(() => ({
            emergencySwitched: false,
            shouldFailover: false,
            refreshed: false
        }));

        window.RecoveryPolicy.create = vi.fn(() => ({
            resetBackoff: vi.fn(),
            resetPlayError: vi.fn(),
            handleNoHealPoint,
            handlePlayFailure: vi.fn(() => ({
                probationTriggered: false,
                repeatStuck: false,
                shouldFailover: false
            })),
            shouldSkipStall: vi.fn(() => false)
        }));
        window.FailoverManager.create = vi.fn(() => ({
            isActive: () => false,
            resetFailover: vi.fn(),
            attemptFailover: vi.fn(),
            probeCandidate: vi.fn(),
            shouldIgnoreStall: () => false,
            onMonitorRemoved: vi.fn()
        }));

        try {
            const monitorsById = new Map();
            const candidateSelector = {
                getActiveId: () => 'video-1',
                evaluateCandidates: vi.fn()
            };
            const manager = window.RecoveryManager.create({
                monitorsById,
                candidateSelector,
                getVideoId: () => 'video-1',
                logDebug: () => {},
                onRescan: () => {},
                onPersistentFailure: () => {}
            });

            const video = createVideo({ currentSrc: 'blob:https://www.twitch.tv/stream' });
            const monitorState = {
                lastRefreshAt: Date.now() - CONFIG.stall.REFRESH_COOLDOWN_MS - 1,
                noHealPointCount: 2
            };
            monitorsById.set('video-1', { video, monitor: { state: monitorState } });

            const refreshed = manager.requestRefresh(video, monitorState, {
                reason: 'processing_asset_exhausted',
                now: Date.now()
            });
            expect(refreshed).toBe(true);

            manager.handleNoHealPoint(video, monitorState, 'no_heal_point');
            expect(handleNoHealPoint.mock.calls.at(-1)[1]).toBe('processing_asset_hard_failure');

            vi.advanceTimersByTime(CONFIG.stall.PROCESSING_ASSET_HARD_FAILURE_WINDOW_MS + 1);
            manager.handleNoHealPoint(video, monitorState, 'no_heal_point');
            expect(handleNoHealPoint.mock.calls.at(-1)[1]).toBe('no_heal_point');
        } finally {
            window.RecoveryPolicy.create = originalRecoveryPolicyCreate;
            window.FailoverManager.create = originalFailoverManagerCreate;
            vi.useRealTimers();
        }
    });
});
