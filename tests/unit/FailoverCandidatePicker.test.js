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
        expect(candidate.selectionMode).toBe('trusted');
    });

    it('falls back to viable untrusted candidate when no trusted candidate exists', () => {
        const monitorsById = new Map([
            ['video-1', { video: createVideo(), monitor: { state: {} } }],
            ['video-2', { video: createVideo(), monitor: { state: {} } }],
            ['video-3', { video: createVideo(), monitor: { state: {} } }]
        ]);

        const scoreVideo = (_video, _monitor, videoId) => {
            if (videoId === 'video-2') {
                return {
                    score: 100,
                    progressEligible: false,
                    reasons: ['error'],
                    deadCandidate: false,
                    vs: { readyState: 1, currentSrc: '' },
                    progressStreakMs: 0,
                    progressAgoMs: null
                };
            }
            if (videoId === 'video-3') {
                return {
                    score: 60,
                    progressEligible: false,
                    reasons: [],
                    deadCandidate: false,
                    vs: { readyState: 3, currentSrc: 'blob:to' },
                    progressStreakMs: 0,
                    progressAgoMs: null
                };
            }
            return {
                score: 10,
                progressEligible: true,
                reasons: [],
                deadCandidate: false,
                vs: { readyState: 3, currentSrc: 'blob:from' },
                progressStreakMs: 0,
                progressAgoMs: 0
            };
        };

        const picker = window.FailoverCandidatePicker.create({ monitorsById, scoreVideo });
        const candidate = picker.selectPreferred('video-1');

        expect(candidate).not.toBeNull();
        expect(candidate.id).toBe('video-3');
        expect(candidate.selectionMode).toBe('viable_untrusted_fallback');
    });
});
