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

    it('returns null if no buffered ranges', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Default video has no buffered ranges
        Object.defineProperty(video, 'buffered', {
            value: { length: 0, start: () => 0, end: () => 0 },
            configurable: true
        });
        const result = BufferGapFinder.findHealPoint(video);
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

    it('finds heal point when buffer ahead exists', () => {
        const BufferGapFinder = window.BufferGapFinder;
        // Mock buffered ranges: [0-10], [20-30]
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 2,
                start: (i) => i === 0 ? 0 : 20,
                end: (i) => i === 0 ? 10 : 30
            },
            configurable: true
        });
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video);
        expect(result).not.toBeNull();
        expect(result.start).toBe(20);
        expect(result.end).toBe(30);
        expect(result.gapSize).toBe(15);
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

        const result = BufferGapFinder.findHealPoint(video);
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

    it('formats ranges correctly', () => {
        const BufferGapFinder = window.BufferGapFinder;
        const ranges = [
            { start: 0, end: 10 },
            { start: 20, end: 30 }
        ];
        const formatted = BufferGapFinder.formatRanges(ranges);
        expect(formatted).toBe('[0.00-10.00], [20.00-30.00]');
    });
});
