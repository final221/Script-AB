import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MonitorRegistry reset refresh', () => {
    let originalCreate;
    let lastOptions;

    beforeEach(() => {
        originalCreate = window.PlaybackMonitor.create;
        window.PlaybackMonitor.create = (video, options) => {
            lastOptions = options;
            return {
                start: vi.fn(),
                stop: vi.fn(),
                state: {}
            };
        };
    });

    afterEach(() => {
        window.PlaybackMonitor.create = originalCreate;
        lastOptions = null;
    });

    const createRegistry = (recoveryManager) => {
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
        registry.bind({ candidateSelector, recoveryManager });
        return { registry };
    };

    it('requests refresh on hard reset when no src is present', () => {
        const recoveryManager = { requestRefresh: vi.fn(), onMonitorRemoved: vi.fn() };
        const { registry } = createRegistry(recoveryManager);
        const video = document.createElement('video');

        registry.monitor(video);

        lastOptions.onReset({
            resetType: 'hard',
            reason: 'test',
            videoState: { currentSrc: '', src: '' }
        });

        expect(recoveryManager.requestRefresh).toHaveBeenCalledTimes(1);
        const [videoId] = recoveryManager.requestRefresh.mock.calls[0];
        expect(videoId).toMatch(/^video-\d+$/);
    });

    it('skips refresh on hard reset when src is present', () => {
        const recoveryManager = { requestRefresh: vi.fn(), onMonitorRemoved: vi.fn() };
        const { registry } = createRegistry(recoveryManager);
        const video = document.createElement('video');

        registry.monitor(video);

        lastOptions.onReset({
            resetType: 'hard',
            reason: 'test',
            videoState: { currentSrc: 'blob:https://www.twitch.tv/abc', src: '' }
        });

        expect(recoveryManager.requestRefresh).not.toHaveBeenCalled();
    });
});
