import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const defineProp = (obj, prop, value) => {
    Object.defineProperty(obj, prop, { value, configurable: true });
};

describe('FailoverManager probeCandidate', () => {
    let video;
    let monitorsById;

    beforeEach(() => {
        video = document.createElement('video');
        defineProp(video, 'currentSrc', '');
        defineProp(video, 'readyState', 0);
        video.play = vi.fn().mockResolvedValue();
        document.body.appendChild(video);

        monitorsById = new Map();
        monitorsById.set('video-1', {
            video,
            monitor: { state: { state: 'STALLED', hasProgress: false, lastProgressTime: 0, progressStreakMs: 0, progressEligible: false } }
        });
    });

    afterEach(() => {
        video.remove();
        vi.restoreAllMocks();
    });

    it('skips probing until candidate is ready', () => {
        const FailoverManager = window.FailoverManager;
        const manager = FailoverManager.create({
            monitorsById,
            candidateSelector: { setActiveId: () => {}, scoreVideo: () => ({ score: 0, progressEligible: false, reasons: [], vs: {}, progressStreakMs: 0, progressAgoMs: null }) },
            getVideoId: () => 'video-1',
            logDebug: () => {}
        });

        const probed = manager.probeCandidate('video-1', 'test');
        expect(probed).toBe(false);
        expect(video.play).not.toHaveBeenCalled();
    });

    it('respects probe cooldown once ready', () => {
        video.setAttribute('src', 'blob:test');
        defineProp(video, 'currentSrc', 'blob:test');
        defineProp(video, 'readyState', 2);
        expect(document.contains(video)).toBe(true);
        expect(video.readyState).toBe(2);
        expect(video.currentSrc || video.getAttribute('src')).toBe('blob:test');

        const FailoverManager = window.FailoverManager;
        const manager = FailoverManager.create({
            monitorsById,
            candidateSelector: { setActiveId: () => {}, scoreVideo: () => ({ score: 0, progressEligible: false, reasons: [], vs: {}, progressStreakMs: 0, progressAgoMs: null }) },
            getVideoId: () => 'video-1',
            logDebug: () => {}
        });

        const nowSpy = vi.spyOn(Date, 'now');
        nowSpy.mockReturnValue(1000);
        expect(manager.probeCandidate('video-1', 'test')).toBe(true);
        expect(video.play).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(2000);
        expect(manager.probeCandidate('video-1', 'test')).toBe(false);
        expect(video.play).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(8000);
        expect(manager.probeCandidate('video-1', 'test')).toBe(true);
        expect(video.play).toHaveBeenCalledTimes(2);
    });
});
