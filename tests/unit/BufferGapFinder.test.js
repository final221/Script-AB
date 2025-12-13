import { describe, it, expect, beforeEach } from 'vitest';

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
        Object.defineProperty(video, 'buffered', {
            value: { length: 0, start: () => 0, end: () => 0 },
            configurable: true
        });
        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).toBeNull();
    });

    it('returns empty array for no buffer ranges', () => {
        const BufferGapFinder = window.BufferGapFinder;
        Object.defineProperty(video, 'buffered', {
            value: { length: 0, start: () => 0, end: () => 0 },
            configurable: true
        });
        const ranges = BufferGapFinder.getBufferRanges(video);
        expect(ranges).toEqual([]);
    });

    it('finds heal point when buffer ahead exists with sufficient size', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock buffered ranges: [0-10], [20-30] (second range is 10s, > MIN_HEAL_BUFFER_S)
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 2,
                start: (i) => i === 0 ? 0 : 20,
                end: (i) => i === 0 ? 10 : 30
            },
            configurable: true
        });
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).not.toBeNull();
        expect(result.start).toBe(20);
        expect(result.end).toBe(30);
        expect(result.gapSize).toBe(15);
    });

    it('skips heal point if buffer is too small', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock buffered ranges: [0-10], [20-21] (second range is only 1s, < MIN_HEAL_BUFFER_S)
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 2,
                start: (i) => i === 0 ? 0 : 20,
                end: (i) => i === 0 ? 10 : 21
            },
            configurable: true
        });
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).toBeNull(); // Too small, should skip
    });

    it('finds first valid heal point when multiple buffers ahead', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock: [0-10], [20-21] (too small), [30-35] (valid)
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 3,
                start: (i) => [0, 20, 30][i],
                end: (i) => [10, 21, 35][i]
            },
            configurable: true
        });
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).not.toBeNull();
        expect(result.start).toBe(30); // Should skip [20-21], find [30-35]
        expect(result.end).toBe(35);
    });

    it('returns null if no buffer ahead of currentTime', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock buffered ranges: [0-10], [12-20]
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 2,
                start: (i) => i === 0 ? 0 : 12,
                end: (i) => i === 0 ? 10 : 20
            },
            configurable: true
        });
        video.currentTime = 15; // Already in second range

        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).toBeNull();
    });

    it('detects buffer exhaustion', () => {
        const BufferGapFinder = window.BufferGapFinder;
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 1,
                start: () => 0,
                end: () => 10
            },
            configurable: true
        });
        video.currentTime = 9.8; // Very close to buffer end

        const result = BufferGapFinder.isBufferExhausted(video);
        expect(result).toBe(true);
    });

    it('detects healthy buffer', () => {
        const BufferGapFinder = window.BufferGapFinder;
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 1,
                start: () => 0,
                end: () => 10
            },
            configurable: true
        });
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
        Object.defineProperty(video, 'buffered', {
            value: { length: 0, start: () => 0, end: () => 0 },
            configurable: true
        });

        // Should not throw, even with no buffer
        const result = BufferGapFinder.findHealPoint(video, { silent: true });
        expect(result).toBeNull();
    });
});
