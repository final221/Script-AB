import { describe, expect, it, vi } from 'vitest';
import { createVideo, setBufferedRanges } from '../helpers/video.js';

describe('PlaybackMediaWatcher', () => {
    it('marks a paused edge-stuck candidate as dead after stale progress', () => {
        const video = createVideo({
            paused: true,
            readyState: 3,
            networkState: 2,
            currentTime: 3.995,
            currentSrc: 'blob:stream'
        });
        setBufferedRanges(video, [[0.08, 4.07]]);
        const state = PlaybackStateStore.create(video);
        state.hasProgress = true;
        state.lastProgressTime = Date.now() - (CONFIG.monitoring.DEAD_CANDIDATE_AFTER_MS + 1000);

        const watcher = PlaybackMediaWatcher.create({
            video,
            videoId: 'video-1',
            state,
            logDebug: vi.fn()
        });

        watcher.update(Date.now());

        expect(state.deadCandidateUntil).toBeGreaterThan(Date.now());
    });

    it('does not mark an actively progressing candidate as dead', () => {
        const video = createVideo({
            paused: false,
            readyState: 4,
            networkState: 2,
            currentTime: 1508.089,
            currentSrc: 'blob:stream'
        });
        setBufferedRanges(video, [[1483.9, 1515.92]]);
        const state = PlaybackStateStore.create(video);
        state.hasProgress = true;
        state.lastProgressTime = Date.now();

        const watcher = PlaybackMediaWatcher.create({
            video,
            videoId: 'video-2',
            state,
            logDebug: vi.fn()
        });

        watcher.update(Date.now());

        expect(state.deadCandidateUntil).toBe(0);
    });
});
