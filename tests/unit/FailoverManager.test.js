import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

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

describe('FailoverManager attemptFailover', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('respects FAILOVER_COOLDOWN_MS after a completed attempt', () => {
        vi.useFakeTimers();
        const nowSpy = vi.spyOn(Date, 'now');

        const fromVideo = createVideo({
            currentTime: 0,
            readyState: 2,
            currentSrc: 'blob:from'
        }, [[0, 10]]);
        fromVideo.play = vi.fn().mockResolvedValue();
        const toVideo = createVideo({
            currentTime: 0,
            readyState: 2,
            currentSrc: 'blob:to'
        }, [[0, 10]]);
        toVideo.play = vi.fn().mockResolvedValue();

        const monitorsById = new Map([
            ['video-1', { video: fromVideo, monitor: { state: { hasProgress: false, lastProgressTime: 0 } } }],
            ['video-2', { video: toVideo, monitor: { state: { hasProgress: false, lastProgressTime: 0 } } }]
        ]);

        const candidateSelector = {
            setActiveId: vi.fn(),
            scoreVideo: vi.fn().mockReturnValue({
                score: 10,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressStreakMs: 0,
                progressAgoMs: 0
            })
        };

        const manager = window.FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId: () => 'video-1',
            logDebug: () => {}
        });

        const startTime = CONFIG.stall.FAILOVER_COOLDOWN_MS + 1000;
        nowSpy.mockReturnValue(startTime);
        const first = manager.attemptFailover('video-1', 'test', monitorsById.get('video-1').monitor.state);
        expect(first).toBe(true);
        expect(candidateSelector.setActiveId).toHaveBeenCalledTimes(1);

        manager.resetFailover('test_reset');

        nowSpy.mockReturnValue(startTime + CONFIG.stall.FAILOVER_COOLDOWN_MS - 1);
        const second = manager.attemptFailover('video-1', 'test', monitorsById.get('video-1').monitor.state);
        expect(second).toBe(false);
        expect(candidateSelector.setActiveId).toHaveBeenCalledTimes(1);

        nowSpy.mockReturnValue(startTime + CONFIG.stall.FAILOVER_COOLDOWN_MS + 1);
        const third = manager.attemptFailover('video-1', 'test', monitorsById.get('video-1').monitor.state);
        expect(third).toBe(true);
        expect(candidateSelector.setActiveId).toHaveBeenCalledTimes(2);
    });

    it('reverts to the previous candidate when the failover candidate never progresses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);

        const fromVideo = createVideo({
            currentTime: 0,
            readyState: 2,
            currentSrc: 'blob:from'
        }, [[0, 10]]);
        fromVideo.play = vi.fn().mockResolvedValue();

        const toVideo = createVideo({
            currentTime: 0,
            readyState: 2,
            currentSrc: 'blob:to'
        }, [[0, 10]]);
        toVideo.play = vi.fn().mockResolvedValue();

        const monitorsById = new Map([
            ['video-1', { video: fromVideo, monitor: { state: { hasProgress: false, lastProgressTime: 0 } } }],
            ['video-2', { video: toVideo, monitor: { state: { hasProgress: false, lastProgressTime: 0 } } }]
        ]);

        const candidateSelector = {
            setActiveId: vi.fn(),
            scoreVideo: vi.fn().mockReturnValue({
                score: 10,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressStreakMs: 0,
                progressAgoMs: 0
            })
        };

        Logger.getLogs().length = 0;

        const manager = window.FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId: () => 'video-1',
            logDebug: () => {}
        });

        const attempted = manager.attemptFailover('video-1', 'test', monitorsById.get('video-1').monitor.state);
        expect(attempted).toBe(true);
        expect(candidateSelector.setActiveId).toHaveBeenCalledWith('video-2');

        vi.advanceTimersByTime(CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS + 1);

        expect(candidateSelector.setActiveId).toHaveBeenLastCalledWith('video-1');
        expect(candidateSelector.setActiveId).toHaveBeenCalledTimes(2);
        expect(manager.isActive()).toBe(false);

        const logs = Logger.getLogs();
        const revertLogged = logs.some((entry) => entry.message === LogTags.TAG.FAILOVER_REVERT);
        expect(revertLogged).toBe(true);
    });
});
