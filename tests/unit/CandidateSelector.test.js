import { describe, it, expect, vi } from 'vitest';

const defineProp = (obj, prop, value) => {
    Object.defineProperty(obj, prop, { value, configurable: true });
};

const makeVideo = (options = {}) => {
    const video = document.createElement('video');
    defineProp(video, 'paused', options.paused ?? false);
    defineProp(video, 'readyState', options.readyState ?? 4);
    defineProp(video, 'currentTime', options.currentTime ?? 1);
    defineProp(video, 'currentSrc', options.currentSrc ?? 'blob:video');
    defineProp(video, 'buffered', options.buffered ?? { length: 0, start: () => 0, end: () => 0 });
    document.body.appendChild(video);
    return video;
};

describe('CandidateSelector', () => {
    it('does not prune active or last-good candidates', () => {
        const CandidateSelector = window.CandidateSelector;
        const monitorsById = new Map();
        const selector = CandidateSelector.create({
            monitorsById,
            logDebug: () => {},
            maxMonitors: 2,
            minProgressMs: 5000,
            switchDelta: 2,
            isFallbackSource: () => false
        });

        const now = Date.now();
        const video1 = makeVideo({ paused: true, readyState: 0, currentTime: 0, currentSrc: '' });
        const video2 = makeVideo({ paused: true, readyState: 0, currentTime: 0, currentSrc: '' });
        const video3 = makeVideo({ buffered: { length: 1, start: () => 0, end: () => 10 }, currentTime: 10 });

        monitorsById.set('video-1', {
            video: video1,
            monitor: { state: { state: 'PLAYING', hasProgress: false, lastProgressTime: 0, progressStreakMs: 0, progressEligible: false } }
        });
        monitorsById.set('video-2', {
            video: video2,
            monitor: { state: { state: 'PLAYING', hasProgress: true, lastProgressTime: now, progressStreakMs: 6000, progressEligible: true } }
        });
        monitorsById.set('video-3', {
            video: video3,
            monitor: { state: { state: 'PLAYING', hasProgress: true, lastProgressTime: now, progressStreakMs: 1000, progressEligible: false } }
        });

        selector.setActiveId('video-1');
        selector.evaluateCandidates('test');

        const stopMonitoring = vi.fn();
        selector.pruneMonitors('video-x', stopMonitoring);

        expect(stopMonitoring).toHaveBeenCalledTimes(1);
        expect(stopMonitoring).toHaveBeenCalledWith(video3);
    });

    it('switches away from an active ENDED candidate', () => {
        const CandidateSelector = window.CandidateSelector;
        const monitorsById = new Map();
        const selector = CandidateSelector.create({
            monitorsById,
            logDebug: () => {},
            maxMonitors: 3,
            minProgressMs: 5000,
            switchDelta: 2,
            isFallbackSource: () => false
        });

        const now = Date.now();
        const endedVideo = makeVideo({
            paused: true,
            readyState: 1,
            currentTime: 10,
            currentSrc: 'blob:ended'
        });
        defineProp(endedVideo, 'ended', true);

        const goodVideo = makeVideo({
            paused: false,
            readyState: 4,
            currentTime: 100,
            currentSrc: 'blob:live',
            buffered: { length: 1, start: () => 90, end: () => 110 }
        });

        monitorsById.set('video-1', {
            video: endedVideo,
            monitor: { state: { state: 'ENDED', hasProgress: true, lastProgressTime: now - 10000, progressStreakMs: 0, progressEligible: false } }
        });
        monitorsById.set('video-2', {
            video: goodVideo,
            monitor: { state: { state: 'PLAYING', hasProgress: true, lastProgressTime: now, progressStreakMs: 8000, progressEligible: true } }
        });

        selector.setActiveId('video-1');
        selector.evaluateCandidates('test');

        expect(selector.getActiveId()).toBe('video-2');
    });
});
