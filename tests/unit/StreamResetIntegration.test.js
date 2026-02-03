import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo, defineVideoProps } from '../helpers/video.js';

describe('Stream reset integration', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('requests refresh after a hard reset from source loss', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);

        const monitoring = MonitoringOrchestrator.create({
            logDebug: () => {},
            isHealing: () => false,
            isFallbackSource: () => false
        });

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' });
        document.body.appendChild(video);

        monitoring.monitor(video);

        const refreshSpy = vi.spyOn(monitoring.recoveryManager, 'requestRefresh');

        defineVideoProps(video, { readyState: 0, networkState: 0, src: '' });
        Object.defineProperty(video, 'currentSrc', { configurable: true, get: () => '' });
        video.getAttribute = vi.fn().mockImplementation(() => '');

        video.dispatchEvent(new Event('emptied'));

        const videoId = monitoring.getVideoId(video);
        const entry = monitoring.monitorsById.get(videoId);
        const pendingForMs = CONFIG.stall.RESET_GRACE_MS + 1;

        expect(entry.monitor.state.resetPendingAt).toBeGreaterThan(0);
        expect(entry.monitor.state.resetPendingType).toBe('hard');
        expect(typeof entry.monitor.state.resetPendingCallback).toBe('function');

        entry.monitor.state.resetPendingAt = Date.now() - pendingForMs;
        entry.monitor.state.resetPendingCallback({
            reason: 'emptied',
            resetType: entry.monitor.state.resetPendingType,
            pendingForMs,
            videoState: VideoState.get(video, videoId)
        }, entry.monitor.state);

        expect(refreshSpy).toHaveBeenCalled();

        monitoring.stopMonitoring(video);
    });
});
