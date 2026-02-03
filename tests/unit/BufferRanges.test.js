import { describe, it, expect } from 'vitest';
import { setBufferedRanges } from '../helpers/video.js';

describe('BufferRanges', () => {
    it('returns partial ranges when TimeRanges throws during read', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 2,
                start: (i) => {
                    if (i === 1) {
                        throw new Error('boom');
                    }
                    return i * 10;
                },
                end: (i) => {
                    if (i === 1) {
                        throw new Error('boom');
                    }
                    return i * 10 + 5;
                }
            },
            configurable: true
        });

        const ranges = BufferGapFinder.getBufferRanges(video);
        expect(ranges).toEqual([{ start: 0, end: 5 }]);
    });

    it('marks buffer presence even when currentTime is in a gap', () => {
        const video = document.createElement('video');
        setBufferedRanges(video, [[0, 10], [20, 30]]);
        video.currentTime = 15;

        const result = BufferGapFinder.getBufferAhead(video);
        expect(result.hasBuffer).toBe(true);
        expect(result.bufferAhead).toBeNull();
        expect(result.rangeStart).toBeNull();
        expect(result.rangeEnd).toBeNull();
    });

    it('treats gaps as buffer exhaustion for stall detection', () => {
        const video = document.createElement('video');
        setBufferedRanges(video, [[0, 10], [20, 30]]);
        video.currentTime = 15;

        const exhausted = BufferGapFinder.isBufferExhausted(video);
        expect(exhausted).toBe(true);
    });
});
