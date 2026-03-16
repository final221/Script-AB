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
        let activeId = null;
        const candidateSelector = {
            getActiveId: () => activeId,
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
        return {
            registry,
            setActiveId: (value) => {
                activeId = value;
            }
        };
    };

    it('requests refresh on active hard reset when no src is present', () => {
        const recoveryManager = { requestRefresh: vi.fn(), canRequestRefresh: vi.fn(() => ({ allow: true, reason: 'hard_reset' })), onMonitorRemoved: vi.fn() };
        const { registry, setActiveId } = createRegistry(recoveryManager);
        const video = document.createElement('video');

        registry.monitor(video);
        setActiveId(registry.getVideoId(video));

        lastOptions.onReset({
            resetType: 'hard',
            reason: 'test',
            videoState: { currentSrc: '', src: '' }
        });

        expect(recoveryManager.requestRefresh).toHaveBeenCalledTimes(1);
        const [videoId] = recoveryManager.requestRefresh.mock.calls[0];
        expect(videoId).toMatch(/^video-\d+$/);
    });

    it('drops non-active hard reset placeholders instead of refreshing them', () => {
        const recoveryManager = { requestRefresh: vi.fn(), canRequestRefresh: vi.fn(), onMonitorRemoved: vi.fn() };
        const { registry, setActiveId } = createRegistry(recoveryManager);
        const video = document.createElement('video');

        registry.monitor(video);
        setActiveId('video-other');

        lastOptions.onReset({
            resetType: 'hard',
            reason: 'test',
            videoState: { currentSrc: '', src: '' }
        });

        expect(recoveryManager.requestRefresh).not.toHaveBeenCalled();
        expect(recoveryManager.canRequestRefresh).not.toHaveBeenCalled();
        expect(recoveryManager.onMonitorRemoved).toHaveBeenCalledTimes(1);
        expect(registry.getMonitoredCount()).toBe(0);
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
