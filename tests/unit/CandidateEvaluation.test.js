import { describe, it, expect, vi } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('CandidateEvaluation', () => {
    it('returns best candidates across trust and dead filters', () => {
        const monitorsById = new Map();
        const video1 = createVideo({ currentTime: 10, readyState: 3, currentSrc: 'src-1' });
        const video2 = createVideo({ currentTime: 20, readyState: 3, currentSrc: 'src-2' });
        const video3 = createVideo({ currentTime: 30, readyState: 3, currentSrc: 'src-3' });

        monitorsById.set('video-1', { video: video1, monitor: { state: { state: 'PLAYING' } } });
        monitorsById.set('video-2', { video: video2, monitor: { state: { state: 'PLAYING' } } });
        monitorsById.set('video-3', { video: video3, monitor: { state: { state: 'PLAYING' } } });

        const results = {
            'video-1': {
                score: 5,
                deadCandidate: false,
                progressEligible: true,
                progressAgoMs: 0,
                progressStreakMs: 6000,
                reasons: [],
                vs: { paused: false, readyState: 3, currentSrc: 'src-1' }
            },
            'video-2': {
                score: 8,
                deadCandidate: true,
                progressEligible: true,
                progressAgoMs: 0,
                progressStreakMs: 6000,
                reasons: [],
                vs: { paused: false, readyState: 3, currentSrc: 'src-2' }
            },
            'video-3': {
                score: 7,
                deadCandidate: false,
                progressEligible: false,
                progressAgoMs: 0,
                progressStreakMs: 1000,
                reasons: [],
                vs: { paused: false, readyState: 3, currentSrc: 'src-3' }
            }
        };

        const scoreVideo = vi.fn((video, monitor, videoId) => results[videoId]);

        const evaluation = CandidateEvaluation.evaluate({
            monitorsById,
            activeCandidateId: 'video-1',
            scoreVideo
        });

        expect(scoreVideo).toHaveBeenCalledTimes(3);
        expect(evaluation.scores).toHaveLength(3);
        expect(evaluation.current.id).toBe('video-1');
        expect(evaluation.best.id).toBe('video-2');
        expect(evaluation.bestNonDead.id).toBe('video-3');
        expect(evaluation.bestTrusted.id).toBe('video-2');
        expect(evaluation.bestTrustedNonDead.id).toBe('video-1');
    });
});
