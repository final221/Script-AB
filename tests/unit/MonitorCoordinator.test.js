import { describe, it, expect, vi, afterEach } from 'vitest';

describe('MonitorCoordinator', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
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
});
