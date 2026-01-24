import { describe, it, expect, beforeEach } from 'vitest';
import { setBufferedRanges } from '../helpers/video.js';

describe('BufferGapFinder', () => {
    let video;

    beforeEach(() => {
        video = document.createElement('video');
    });

    it('is defined globally', () => {
        expect(window.BufferGapFinder).toBeDefined();
    });

    it('has findHealPoint method', () => {
        expect(typeof window.BufferGapFinder.findHealPoint).toBe('function');
    });

    it('has isBufferExhausted method', () => {
        expect(typeof window.BufferGapFinder.isBufferExhausted).toBe('function');
    });

    it('has getBufferRanges method', () => {
        expect(typeof window.BufferGapFinder.getBufferRanges).toBe('function');
    });

    it('has formatRanges method', () => {
        expect(typeof window.BufferGapFinder.formatRanges).toBe('function');
    });

    it('exposes MIN_HEAL_BUFFER_S constant', () => {
        expect(window.BufferGapFinder.MIN_HEAL_BUFFER_S).toBeDefined();
        expect(window.BufferGapFinder.MIN_HEAL_BUFFER_S).toBe(2);
    });

    it('returns null if no buffered ranges', () => {
        const BufferGapFinder = window.BufferGapFinder;
        setBufferedRanges(video, []);
        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).toBeNull();
    });

    it('returns empty array for no buffer ranges', () => {
        const BufferGapFinder = window.BufferGapFinder;
        setBufferedRanges(video, []);
        const ranges = BufferGapFinder.getBufferRanges(video);
        expect(ranges).toEqual([]);
    });

    it('finds heal point (nudge) when contiguous buffer ahead exists', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock buffered ranges: [0-10], [20-30]
        setBufferedRanges(video, [[0, 10], [20, 30]]);
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).not.toBeNull();
        expect(result.isNudge).toBe(true);
        expect(result.start).toBe(5.5); // Nudge: current + 0.5
        expect(result.end).toBe(10);
    });

    it('falls back to emergency heal point if buffer is too small', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock buffered ranges: [0-5.5] - Current 5, so 0.5s ahead (too small for nudge which needs gap > MIN_HEAL_BUFFER_S)
        setBufferedRanges(video, [[0, 5.5]]);
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).not.toBeNull();
        expect(result.start).toBeGreaterThanOrEqual(0);
        expect(result.end).toBe(5.5);
    });

    it('prefers contiguous nudge over distant gap', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock: [0-10] (contiguous), [30-35] (gap)
        setBufferedRanges(video, [[0, 10], [30, 35]]);
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).not.toBeNull();
        expect(result.isNudge).toBe(true);
        expect(result.start).toBe(5.5);
    });

    it('returns nudge if contiguous buffer ahead of currentTime', () => {
        const BufferGapFinder = window.BufferGapFinder;
        setBufferedRanges(video, [[0, 20]]);
        video.currentTime = 15;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).not.toBeNull();
        expect(result.isNudge).toBe(true);
        expect(result.start).toBe(15.5);
    });

    it('detects buffer exhaustion', () => {
        const BufferGapFinder = window.BufferGapFinder;
        setBufferedRanges(video, [[0, 10]]);
        video.currentTime = 9.8; // Very close to buffer end

        const result = BufferGapFinder.isBufferExhausted(video);
        expect(result).toBe(true);
    });

    it('detects healthy buffer', () => {
        const BufferGapFinder = window.BufferGapFinder;
        setBufferedRanges(video, [[0, 10]]);
        video.currentTime = 5; // Plenty of buffer ahead

        const result = BufferGapFinder.isBufferExhausted(video);
        expect(result).toBe(false);
    });

    it('formats ranges correctly', () => {
        const BufferGapFinder = window.BufferGapFinder;
        const ranges = [
            { start: 0, end: 10 },
            { start: 20, end: 30 }
        ];
        const formatted = BufferGapFinder.formatRanges(ranges);
        expect(formatted).toBe('[0.00-10.00], [20.00-30.00]');
    });

    it('formats empty ranges as "none"', () => {
        const BufferGapFinder = window.BufferGapFinder;
        const formatted = BufferGapFinder.formatRanges([]);
        expect(formatted).toBe('none');
    });

    it('supports silent mode for polling', () => {
        const BufferGapFinder = window.BufferGapFinder;
        setBufferedRanges(video, []);

        // Should not throw, even with no buffer
        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).toBeNull();
    });
});
