import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('LiveEdgeSeeker', () => {
    let video;

    beforeEach(() => {
        video = document.createElement('video');
        Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
        video.play = vi.fn().mockResolvedValue(undefined);
        video.pause = vi.fn();
    });

    it('is defined globally', () => {
        expect(window.LiveEdgeSeeker).toBeDefined();
    });

    it('seeks to the target time', async () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        const target = 100;
        await LiveEdgeSeeker.seekTo(video, target);
        expect(video.currentTime).toBe(target);
    });

    it('attempts to play after seeking', async () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        await LiveEdgeSeeker.seekTo(video, 50);
        expect(video.play).toHaveBeenCalled();
    });
});
