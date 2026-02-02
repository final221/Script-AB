import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('LiveEdgeSeeker', () => {
    let video;

    beforeEach(() => {
        video = document.createElement('video');
        Object.defineProperty(video, 'duration', { value: Infinity, configurable: true });
        Object.defineProperty(video, 'paused', { value: true, configurable: true, writable: true });
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 1,
                start: () => 90,
                end: () => 110
            },
            configurable: true
        });
        video.play = vi.fn().mockResolvedValue(undefined);
        video.pause = vi.fn();
    });

    it('is defined globally', () => {
        expect(window.LiveEdgeSeeker).toBeDefined();
    });

    it('has seekAndPlay method', () => {
        expect(typeof window.LiveEdgeSeeker.seekAndPlay).toBe('function');
    });

    it('has validateSeekTarget method', () => {
        expect(typeof window.LiveEdgeSeeker.validateSeekTarget).toBe('function');
    });

    it('has calculateSafeTarget method', () => {
        expect(typeof window.LiveEdgeSeeker.calculateSafeTarget).toBe('function');
    });

    it('calculates safe target for heal point', () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        const healPoint = { start: 100, end: 110 };
        const target = LiveEdgeSeeker.calculateSafeTarget(healPoint);
        // For buffer >= 1s, should be start + 0.5 (unless that leaves < 1s headroom)
        expect(target).toBeGreaterThanOrEqual(healPoint.start);
        expect(target).toBeLessThan(healPoint.end);
    });

    it('validates target within buffer', () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        const result = LiveEdgeSeeker.validateSeekTarget(video, 100);
        expect(result.valid).toBe(true);
    });

    it('rejects target outside buffer', () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        const result = LiveEdgeSeeker.validateSeekTarget(video, 50); // Before buffer start
        expect(result.valid).toBe(false);
    });

    it('reports buffer read failure when TimeRanges throws', () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        const brokenVideo = document.createElement('video');
        Object.defineProperty(brokenVideo, 'buffered', {
            value: {
                length: 1,
                start: () => {
                    throw new Error('boom');
                },
                end: () => {
                    throw new Error('boom');
                }
            },
            configurable: true
        });

        const result = LiveEdgeSeeker.validateSeekTarget(brokenVideo, 100);
        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Buffer read failed');
    });

    it('aborts invalid seek targets without attempting play', async () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        const invalidVideo = document.createElement('video');
        Object.defineProperty(invalidVideo, 'currentTime', { value: 0, configurable: true, writable: true });
        Object.defineProperty(invalidVideo, 'paused', { value: true, configurable: true, writable: true });
        Object.defineProperty(invalidVideo, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(invalidVideo, 'buffered', {
            value: {
                length: 1,
                start: () => 0,
                end: () => 1
            },
            configurable: true
        });
        invalidVideo.play = vi.fn().mockResolvedValue(undefined);

        const result = await LiveEdgeSeeker.seekAndPlay(invalidVideo, { start: 10, end: 12 });

        expect(result.success).toBe(false);
        expect(result.errorName).toBe('INVALID_TARGET');
        expect(invalidVideo.play).not.toHaveBeenCalled();
    });

    it('treats already-playing video as success without calling play', async () => {
        const LiveEdgeSeeker = window.LiveEdgeSeeker;
        Object.defineProperty(video, 'currentTime', { value: 95, configurable: true, writable: true });
        Object.defineProperty(video, 'paused', { value: false, configurable: true, writable: true });

        const result = await LiveEdgeSeeker.seekAndPlay(video, { start: 100, end: 110 });

        expect(result.success).toBe(true);
        expect(video.play).not.toHaveBeenCalled();
    });
});
