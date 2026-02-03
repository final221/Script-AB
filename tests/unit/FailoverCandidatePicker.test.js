import { describe, it, expect } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('FailoverCandidatePicker', () => {
    it('CHALLENGE: prefers trusted candidate over higher-score untrusted', () => {
        const monitorsById = new Map([
            ['video-1', { video: createVideo(), monitor: { state: {} } }],
            ['video-2', { video: createVideo(), monitor: { state: {} } }],
            ['video-3', { video: createVideo(), monitor: { state: {} } }]
        ]);

        const scoreVideo = (video, monitor, videoId) => {
            if (videoId === 'video-2') {
                return {
                    score: 100,
                    progressEligible: false,
                    reasons: ['error'],
                    vs: {},
                    progressStreakMs: 0,
                    progressAgoMs: CONFIG.monitoring.TRUST_STALE_MS + 1
                };
            }
            if (videoId === 'video-3') {
                return {
                    score: 50,
                    progressEligible: true,
                    reasons: [],
                    vs: {},
                    progressStreakMs: 0,
                    progressAgoMs: 0
                };
            }
            return {
                score: 10,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressStreakMs: 0,
                progressAgoMs: 0
            };
        };

        const picker = window.FailoverCandidatePicker.create({ monitorsById, scoreVideo });
        const candidate = picker.selectPreferred('video-1');

        expect(candidate).not.toBeNull();
        expect(candidate.id).toBe('video-3');
    });
});
