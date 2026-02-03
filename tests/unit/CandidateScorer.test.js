import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('CandidateScorer', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('penalizes fallback sources and missing DOM membership', () => {
        const scorer = window.CandidateScorer.create({
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            isFallbackSource: (src) => src.startsWith('blob:')
        });
        const video = createVideo({
            currentSrc: 'blob:stream',
            paused: true,
            readyState: 2
        });
        const monitor = {
            state: {
                state: MonitorStates.PLAYING,
                hasProgress: false,
                lastProgressTime: 0,
                progressStreakMs: 0,
                progressEligible: false
            }
        };

        const result = scorer.score(video, monitor, 'video-1');

        expect(result.reasons).toContain('fallback_src');
        expect(result.reasons).toContain('not_in_dom');
    });

    it('marks dead candidates when within the dead window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        const scorer = window.CandidateScorer.create({
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            isFallbackSource: () => false
        });
        const video = createVideo({ currentSrc: 'blob:stream', paused: false, readyState: 3 });
        const monitor = {
            state: {
                state: MonitorStates.PLAYING,
                hasProgress: true,
                lastProgressTime: 900,
                progressStreakMs: 1000,
                progressEligible: true,
                deadCandidateUntil: 2000
            }
        };

        const result = scorer.score(video, monitor, 'video-1');

        expect(result.deadCandidate).toBe(true);
        expect(result.reasons).toContain('dead_candidate');
    });

    it('penalizes candidates without sufficient progress streak', () => {
        const scorer = window.CandidateScorer.create({
            minProgressMs: 5000,
            isFallbackSource: () => false
        });
        const video = createVideo({ currentSrc: '', paused: true, readyState: 1 });
        const monitor = {
            state: {
                state: MonitorStates.PLAYING,
                hasProgress: true,
                lastProgressTime: Date.now(),
                progressStreakMs: 1000,
                progressEligible: false
            }
        };

        const result = scorer.score(video, monitor, 'video-1');

        expect(result.progressEligible).toBe(false);
        expect(result.reasons).toContain('progress_short');
    });

    it('flags recent progress when progress is within the recent window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(5000);
        const scorer = window.CandidateScorer.create({
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            isFallbackSource: () => false
        });
        const video = createVideo({ currentSrc: '', paused: false, readyState: 3 });
        const monitor = {
            state: {
                state: MonitorStates.PLAYING,
                hasProgress: true,
                lastProgressTime: 4800,
                progressStreakMs: 6000,
                progressEligible: true
            }
        };

        const result = scorer.score(video, monitor, 'video-1');

        expect(result.reasons).toContain('recent_progress');
    });

    it('penalizes paused candidates', () => {
        const scorer = window.CandidateScorer.create({
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            isFallbackSource: () => false
        });
        const video = createVideo({ currentSrc: 'blob:stream', paused: true, readyState: 3 });
        const monitor = {
            state: {
                state: MonitorStates.PLAYING,
                hasProgress: true,
                lastProgressTime: Date.now(),
                progressStreakMs: 6000,
                progressEligible: true
            }
        };

        const result = scorer.score(video, monitor, 'video-1');

        expect(result.reasons).toContain('paused');
    });
});
