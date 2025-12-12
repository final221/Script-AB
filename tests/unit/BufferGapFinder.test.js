import { describe, it, expect } from 'vitest';

// Tests for BufferGapFinder assuming it is loaded globally by setup.js
describe('BufferGapFinder', () => {
    it('is defined globally', () => {
        expect(window.BufferGapFinder).toBeDefined();
    });

    it('returns null if there are no buffered ranges', () => {
        const BufferGapFinder = window.BufferGapFinder;
        const video = document.createElement('video');
        const result = BufferGapFinder.findHealPoint(video); // method name is findHealPoint in source!
        expect(result).toBeNull();
    });

    it('returns null if buffered ranges are empty', () => {
        const BufferGapFinder = window.BufferGapFinder;
        const video = document.createElement('video');
        video.buffered = {
            length: 0,
            start: () => 0,
            end: () => 0
        };
        const result = BufferGapFinder.findHealPoint(video);
        expect(result).toBeNull();
    });

    it('finds the heal point', () => {
        const BufferGapFinder = window.BufferGapFinder;
        const video = document.createElement('video');
        // Mock buffered ranges: [0-10], [20-30]
        video.buffered = {
            length: 2,
            start: (i) => i === 0 ? 0 : 20,
            end: (i) => i === 0 ? 10 : 30
        };
        video.currentTime = 5;

        const result = BufferGapFinder.findHealPoint(video);
        // Expect result to be object { start: 20, end: 30, gapSize: 15 }
        expect(result).not.toBeNull();
        expect(result.start).toBe(20);
        expect(result.gapSize).toBe(15);
    });
});
