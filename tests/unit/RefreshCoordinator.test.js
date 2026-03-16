import { describe, it, expect, vi, afterEach } from 'vitest';

describe('RefreshCoordinator', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
        try {
            sessionStorage.removeItem('twad_auto_refresh_at');
        } catch {
            // ignore storage failures in test env
        }
    });

    it('returns element mode when auto page refresh is disabled', () => {
        const coordinator = window.RefreshCoordinator.create({
            monitorRegistry: { monitorsById: new Map() },
            candidateSelector: {},
            logDebug: vi.fn(),
            scanForVideos: vi.fn()
        });

        const plan = coordinator.evaluatePlan({ reason: 'no_source' }, 1000);

        expect(plan.mode).toBe('element');
        expect(plan.reason).toBe('disabled');
    });

    it('returns page mode for forced refresh requests and records cooldown', () => {
        vi.useFakeTimers();
        const video = document.createElement('video');
        const monitorRegistry = {
            monitorsById: new Map([['video-1', { video, monitor: { state: {} } }]]),
            getElementId: () => 1
        };
        const coordinator = window.RefreshCoordinator.create({
            monitorRegistry,
            candidateSelector: {},
            logDebug: vi.fn(),
            scanForVideos: vi.fn()
        });

        const plan = coordinator.evaluatePlan({ forcePageRefresh: true }, 1000);
        expect(plan.mode).toBe('page');

        const refreshed = coordinator.refreshVideo('video-1', {
            reason: 'play_stuck_last_resort',
            forcePageRefresh: true
        });

        expect(refreshed).toBe(true);
        expect(Number(sessionStorage.getItem('twad_auto_refresh_at') || 0)).toBeGreaterThan(0);
    });

    it('refreshes the element and forces replacement takeover after processing-asset exhaustion', () => {
        vi.useFakeTimers();
        const video = document.createElement('video');
        const replacement = document.createElement('video');
        const ids = new WeakMap([
            [video, 'video-1'],
            [replacement, 'video-2']
        ]);
        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: {} } }]
        ]);
        const monitorRegistry = {
            monitorsById,
            getElementId: () => 1,
            stopMonitoring: vi.fn(),
            resetVideoId: vi.fn()
        };
        const preferred = {
            id: 'video-2',
            score: 3,
            progressEligible: false,
            progressStreakMs: 0,
            trusted: false,
            reasons: [],
            vs: {
                readyState: CONFIG.monitoring.PROBATION_READY_STATE,
                currentSrc: 'blob:https://www.twitch.tv/replacement'
            }
        };
        const candidateSelector = {
            forceSwitch: vi.fn()
        };
        const scanForVideos = vi.fn(() => ({
            preferred,
            discovered: [{ video: replacement, videoId: ids.get(replacement) }]
        }));

        const coordinator = window.RefreshCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug: vi.fn(),
            scanForVideos
        });

        const refreshed = coordinator.refreshVideo('video-1', {
            reason: 'processing_asset_exhausted',
            detail: 'no_candidate_progress'
        });

        expect(refreshed).toBe(true);
        expect(monitorRegistry.stopMonitoring).toHaveBeenCalledWith(video);
        expect(monitorRegistry.resetVideoId).toHaveBeenCalledWith(video);

        vi.runOnlyPendingTimers();

        expect(scanForVideos).toHaveBeenCalledWith('refresh', expect.objectContaining({
            videoId: 'video-1',
            reason: 'processing_asset_exhausted'
        }));
        expect(candidateSelector.forceSwitch).toHaveBeenCalledWith(
            preferred,
            expect.objectContaining({
                reason: 'refresh_replacement',
                requireProgressEligible: false,
                requireSevere: false
            })
        );
    });
});
