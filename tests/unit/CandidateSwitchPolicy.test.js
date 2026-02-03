import { describe, it, expect } from 'vitest';

describe('CandidateSwitchPolicy', () => {
    it('fast-switches when healing stalls beyond configured thresholds', () => {
        const now = 100000;
        const policy = window.CandidateSwitchPolicy.create({
            switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            logDebug: () => {}
        });

        const current = {
            id: 'video-1',
            score: 1,
            reasons: [],
            state: MonitorStates.HEALING,
            monitorState: {
                noHealPointCount: CONFIG.stall.FAST_SWITCH_AFTER_NO_HEAL_POINTS,
                lastProgressTime: now - (CONFIG.stall.FAST_SWITCH_AFTER_STALL_MS + 1)
            },
            trusted: false
        };

        const preferred = {
            id: 'video-2',
            score: 10,
            progressEligible: true,
            progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS + 10,
            trusted: true,
            vs: { readyState: 3, currentSrc: 'blob:stream' },
            reasons: []
        };

        const decision = policy.decide({
            now,
            current,
            preferred,
            activeCandidateId: 'video-1',
            probationActive: false,
            scores: [],
            reason: 'healing'
        });

        expect(decision.action).toBe('fast_switch');
        expect(decision.toId).toBe('video-2');
    });

    it('blocks untrusted preferred candidates outside probation', () => {
        const policy = window.CandidateSwitchPolicy.create({
            switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            logDebug: () => {}
        });

        const decision = policy.decide({
            now: 50000,
            current: {
                id: 'video-1',
                score: 5,
                reasons: [],
                state: MonitorStates.STALLED,
                monitorState: { lastProgressTime: 0 },
                trusted: false
            },
            preferred: {
                id: 'video-2',
                score: 8,
                progressEligible: true,
                progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                trusted: false,
                vs: { readyState: 3, currentSrc: 'blob:stream' },
                reasons: []
            },
            activeCandidateId: 'video-1',
            probationActive: false,
            scores: [],
            reason: 'interval'
        });

        expect(decision.action).toBe('stay');
        expect(decision.suppression).toBe('untrusted_outside_probation');
    });

    it('suppresses switching when the active candidate is not stalled', () => {
        const policy = window.CandidateSwitchPolicy.create({
            switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            logDebug: () => {}
        });

        const decision = policy.decide({
            now: 60000,
            current: {
                id: 'video-1',
                score: 5,
                reasons: [],
                state: MonitorStates.PLAYING,
                monitorState: { lastProgressTime: 0 },
                trusted: false
            },
            preferred: {
                id: 'video-2',
                score: 8,
                progressEligible: true,
                progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                trusted: true,
                vs: { readyState: 3, currentSrc: 'blob:stream' },
                reasons: []
            },
            activeCandidateId: 'video-1',
            probationActive: true,
            scores: [],
            reason: 'interval'
        });

        expect(decision.action).toBe('stay');
        expect(decision.suppression).toBe('active_not_stalled');
    });
});
