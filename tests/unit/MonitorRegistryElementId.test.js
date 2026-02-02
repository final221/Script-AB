import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MonitorRegistry element ids', () => {
    let originalCreate;

    beforeEach(() => {
        originalCreate = window.PlaybackMonitor.create;
        window.PlaybackMonitor.create = () => ({
            start: vi.fn(),
            stop: vi.fn(),
            state: {}
        });
    });

    afterEach(() => {
        window.PlaybackMonitor.create = originalCreate;
    });

    const createRegistry = () => {
        const candidateSelector = {
            getActiveId: () => null,
            setActiveId: vi.fn(),
            evaluateCandidates: vi.fn(),
            pruneMonitors: vi.fn()
        };
        const registry = window.MonitorRegistry.create({
            logDebug: () => {},
            isHealing: () => false,
            onStall: () => {}
        });
        registry.bind({ candidateSelector, recoveryManager: { onMonitorRemoved: vi.fn() } });
        return registry;
    };

    it('keeps a stable element id across video id resets', () => {
        const registry = createRegistry();
        const video = document.createElement('video');

        const firstElementId = registry.getElementId(video);
        registry.monitor(video);
        const afterMonitorId = registry.getElementId(video);
        registry.resetVideoId(video);
        const afterResetId = registry.getElementId(video);

        expect(afterMonitorId).toBe(firstElementId);
        expect(afterResetId).toBe(firstElementId);

        const secondVideo = document.createElement('video');
        const secondElementId = registry.getElementId(secondVideo);
        expect(secondElementId).not.toBe(firstElementId);
    });
});
