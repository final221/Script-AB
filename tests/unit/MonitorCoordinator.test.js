import { describe, it, expect, vi, afterEach } from 'vitest';

describe('MonitorCoordinator', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
        Logger.getLogs().length = 0;
        try {
            sessionStorage.removeItem('twad_auto_refresh_at');
        } catch {
            // ignore storage failures in test env
        }
    });

    it('refreshes a video and triggers a rescan', () => {
        vi.useFakeTimers();

        const video = document.createElement('video');
        document.body.appendChild(video);

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: {} } }]
        ]);
        const monitorRegistry = {
            monitorsById,
            getVideoId: () => 'video-1',
            monitor: vi.fn(),
            stopMonitoring: vi.fn(),
            resetVideoId: vi.fn()
        };
        const candidateSelector = {
            evaluateCandidates: vi.fn(),
            getActiveId: vi.fn()
        };

        const coordinator = MonitorCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug: vi.fn()
        });

        const result = coordinator.refreshVideo('video-1', { reason: 'no_source' });

        expect(result).toBe(true);
        expect(monitorRegistry.stopMonitoring).toHaveBeenCalledWith(video);
        expect(monitorRegistry.resetVideoId).toHaveBeenCalledWith(video);

        expect(monitorRegistry.monitor).not.toHaveBeenCalled();
        expect(candidateSelector.evaluateCandidates).not.toHaveBeenCalled();

        vi.runOnlyPendingTimers();

        expect(monitorRegistry.monitor).toHaveBeenCalled();
        expect(candidateSelector.evaluateCandidates).toHaveBeenCalledWith('scan_refresh');
    });

    it('logs scan-item discovery only for newly tracked videos', () => {
        const existing = document.createElement('video');
        const fresh = document.createElement('video');
        document.body.appendChild(existing);
        document.body.appendChild(fresh);

        const ids = new WeakMap([
            [existing, 'video-1'],
            [fresh, 'video-2']
        ]);

        const monitorsById = new Map([
            ['video-1', { video: existing, monitor: { state: {} } }]
        ]);
        const monitorRegistry = {
            monitorsById,
            getVideoId: (video) => ids.get(video),
            monitor: vi.fn(),
            stopMonitoring: vi.fn(),
            resetVideoId: vi.fn()
        };
        const candidateSelector = {
            evaluateCandidates: vi.fn(),
            getActiveId: vi.fn()
        };
        const logDebug = vi.fn();

        const coordinator = MonitorCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug
        });

        coordinator.scanForVideos('manual');

        const scanItemCalls = logDebug.mock.calls.filter((call) => (
            call[0]?.message === LogTags.TAG.SCAN_ITEM
        ));
        expect(scanItemCalls.length).toBe(1);
        expect(scanItemCalls[0][1]?.videoId).toBe('video-2');
        expect(monitorRegistry.monitor).toHaveBeenCalledTimes(2);
    });

    it('forces page refresh path when requested, even if auto refresh is disabled', () => {
        vi.useFakeTimers();
        const autoRefreshBackup = CONFIG.stall.AUTO_PAGE_REFRESH;
        CONFIG.stall.AUTO_PAGE_REFRESH = false;

        try {
            const video = document.createElement('video');
            document.body.appendChild(video);

            const monitorsById = new Map([
                ['video-1', { video, monitor: { state: {} } }]
            ]);
            const monitorRegistry = {
                monitorsById,
                getVideoId: () => 'video-1',
                monitor: vi.fn(),
                stopMonitoring: vi.fn(),
                resetVideoId: vi.fn()
            };
            const candidateSelector = {
                evaluateCandidates: vi.fn(),
                getActiveId: vi.fn()
            };

            const coordinator = MonitorCoordinator.create({
                monitorRegistry,
                candidateSelector,
                logDebug: vi.fn()
            });

            const result = coordinator.refreshVideo('video-1', {
                reason: 'play_stuck_last_resort',
                forcePageRefresh: true
            });

            expect(result).toBe(true);
            expect(monitorRegistry.stopMonitoring).not.toHaveBeenCalled();
            expect(monitorRegistry.resetVideoId).not.toHaveBeenCalled();
            expect(Number(sessionStorage.getItem('twad_auto_refresh_at') || 0)).toBeGreaterThan(0);
        } finally {
            CONFIG.stall.AUTO_PAGE_REFRESH = autoRefreshBackup;
        }
    });

    it('forces takeover to a refreshed candidate after processing-asset exhaustion', () => {
        vi.useFakeTimers();

        const video = document.createElement('video');
        const replacement = document.createElement('video');
        document.body.appendChild(video);
        document.body.appendChild(replacement);

        const ids = new WeakMap([
            [video, 'video-1'],
            [replacement, 'video-2']
        ]);

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: {} } }]
        ]);
        const monitorRegistry = {
            monitorsById,
            getVideoId: (entry) => ids.get(entry),
            monitor: vi.fn((entry) => {
                const id = ids.get(entry);
                if (!monitorsById.has(id)) {
                    monitorsById.set(id, { video: entry, monitor: { state: {} } });
                }
            }),
            stopMonitoring: vi.fn(),
            resetVideoId: vi.fn()
        };
        const preferred = {
            id: 'video-2',
            score: 1,
            progressEligible: false,
            progressStreakMs: 0,
            trusted: false,
            vs: {
                readyState: CONFIG.monitoring.PROBATION_READY_STATE,
                currentSrc: 'blob:https://www.twitch.tv/replacement'
            },
            reasons: ['playing']
        };
        const candidateSelector = {
            evaluateCandidates: vi.fn(() => preferred),
            getActiveId: vi.fn(() => 'video-1'),
            forceSwitch: vi.fn()
        };

        const coordinator = MonitorCoordinator.create({
            monitorRegistry,
            candidateSelector,
            logDebug: vi.fn()
        });

        const result = coordinator.refreshVideo('video-1', {
            reason: 'processing_asset_exhausted',
            detail: 'no_candidate_progress'
        });

        expect(result).toBe(true);

        vi.runOnlyPendingTimers();

        expect(candidateSelector.evaluateCandidates).toHaveBeenCalledWith('scan_refresh');
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
