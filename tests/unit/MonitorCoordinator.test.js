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
});
