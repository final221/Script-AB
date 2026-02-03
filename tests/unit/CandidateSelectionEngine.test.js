import { describe, it, expect, vi } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('CandidateSelectionEngine', () => {
    const makeEntry = () => ({
        video: createVideo(),
        monitor: { state: { state: MonitorStates.PLAYING } }
    });

    it('returns locked status when the lock checker is active', () => {
        const monitorsById = new Map([
            ['video-1', makeEntry()]
        ]);
        const decisionEngine = { decide: vi.fn() };
        const engine = window.CandidateSelectionEngine.create({
            monitorsById,
            scoreVideo: () => ({
                score: 1,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressAgoMs: 0,
                progressStreakMs: 0,
                deadCandidate: false
            }),
            decisionEngine,
            probation: { isActive: () => false },
            getActiveId: () => 'video-1',
            getLastGoodId: () => null,
            getLockChecker: () => () => true
        });

        const result = engine.evaluateCandidates('interval');

        expect(result.status).toBe('locked');
        expect(result.activeCandidateId).toBe('video-1');
        expect(decisionEngine.decide).not.toHaveBeenCalled();
    });

    it('falls back to last good candidate when active is missing', () => {
        const monitorsById = new Map([
            ['video-2', makeEntry()],
            ['video-3', makeEntry()]
        ]);
        const engine = window.CandidateSelectionEngine.create({
            monitorsById,
            scoreVideo: () => ({
                score: 1,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressAgoMs: 0,
                progressStreakMs: 0,
                deadCandidate: false
            }),
            decisionEngine: { decide: vi.fn() },
            probation: { isActive: () => false },
            getActiveId: () => 'video-1',
            getLastGoodId: () => 'video-2',
            getLockChecker: () => null
        });

        const result = engine.evaluateCandidates('interval');

        expect(result.activation?.toId).toBe('video-2');
        expect(result.nextActiveId).toBe('video-2');
    });

    it('prefers trusted non-dead candidates over dead ones', () => {
        const monitorsById = new Map([
            ['video-1', makeEntry()],
            ['video-2', makeEntry()]
        ]);
        const engine = window.CandidateSelectionEngine.create({
            monitorsById,
            scoreVideo: (video, monitor, videoId) => ({
                score: videoId === 'video-1' ? 10 : 5,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressAgoMs: 0,
                progressStreakMs: 0,
                deadCandidate: videoId === 'video-1'
            }),
            decisionEngine: { decide: vi.fn() },
            probation: { isActive: () => false },
            getActiveId: () => 'video-1',
            getLastGoodId: () => null,
            getLockChecker: () => null
        });

        const result = engine.evaluateCandidates('interval');

        expect(result.preferred?.id).toBe('video-2');
    });

    it('returns empty status when no monitors exist', () => {
        const engine = window.CandidateSelectionEngine.create({
            monitorsById: new Map(),
            scoreVideo: () => ({
                score: 0,
                progressEligible: false,
                reasons: [],
                vs: {},
                progressAgoMs: null,
                progressStreakMs: 0,
                deadCandidate: false
            }),
            decisionEngine: { decide: vi.fn() },
            probation: { isActive: () => false },
            getActiveId: () => null,
            getLastGoodId: () => null,
            getLockChecker: () => null
        });

        const result = engine.evaluateCandidates('interval');

        expect(result.status).toBe('empty');
        expect(result.preferred).toBeNull();
    });

    it('does not call decision engine when preferred matches active', () => {
        const monitorsById = new Map([
            ['video-1', makeEntry()]
        ]);
        const decisionEngine = { decide: vi.fn() };
        const engine = window.CandidateSelectionEngine.create({
            monitorsById,
            scoreVideo: () => ({
                score: 2,
                progressEligible: true,
                reasons: [],
                vs: {},
                progressAgoMs: 0,
                progressStreakMs: 0,
                deadCandidate: false
            }),
            decisionEngine,
            probation: { isActive: () => false },
            getActiveId: () => 'video-1',
            getLastGoodId: () => null,
            getLockChecker: () => null
        });

        engine.evaluateCandidates('interval');

        expect(decisionEngine.decide).not.toHaveBeenCalled();
    });
});
