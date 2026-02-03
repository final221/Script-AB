import { describe, it, expect } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlayheadAttribution', () => {
    it('falls back to the active candidate when playhead seconds are invalid', () => {
        const monitorsById = new Map([
            ['video-1', { video: createVideo({ currentTime: 10 }) }]
        ]);
        const candidateSelector = { getActiveId: () => 'video-1' };
        const attribution = PlayheadAttribution.create({ monitorsById, candidateSelector });

        const result = attribution.resolve(NaN);

        expect(result.id).toBe('video-1');
        expect(result.reason).toBe('active_fallback');
        expect(result.playheadSeconds).toBeNull();
    });

    it('selects the closest candidate within the match window', () => {
        const monitorsById = new Map([
            ['video-1', { video: createVideo({ currentTime: 10 }) }],
            ['video-2', { video: createVideo({ currentTime: 20 }) }]
        ]);
        const candidateSelector = { getActiveId: () => 'video-1' };
        const attribution = PlayheadAttribution.create({
            monitorsById,
            candidateSelector,
            matchWindowSeconds: 2
        });

        const result = attribution.resolve(19);

        expect(result.id).toBe('video-2');
        expect(result.reason).toBe('closest_match');
        expect(result.match?.deltaSeconds).toBe(1);
    });
});
