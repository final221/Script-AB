import { describe, it, expect, vi, afterEach } from 'vitest';

describe('PlayErrorPolicy', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('decays old errors and applies abort-specific backoff', () => {
        vi.useFakeTimers();
        const now = new Date('2026-02-01T00:00:00Z');
        vi.setSystemTime(now);

        const video = document.createElement('video');
        const monitorState = {
            playErrorCount: 5,
            lastPlayErrorTime: now.getTime() - (CONFIG.stall.PLAY_ERROR_DECAY_MS + 1)
        };
        const monitorsById = new Map([
            ['video-1', { video }]
        ]);
        const probationPolicy = { maybeTriggerProbation: vi.fn() };
        const policy = window.PlayErrorPolicy.create({
            monitorsById,
            logDebug: () => {},
            probationPolicy
        });
        const context = window.RecoveryContext.create(video, monitorState, () => 'video-1');

        const decision = policy.decide(context, { errorName: 'AbortError' });

        const expectedBase = CONFIG.stall.PLAY_ABORT_BACKOFF_BASE_MS
            || CONFIG.stall.PLAY_ERROR_BACKOFF_BASE_MS;
        const expectedMax = CONFIG.stall.PLAY_ABORT_BACKOFF_MAX_MS
            || CONFIG.stall.PLAY_ERROR_BACKOFF_MAX_MS;

        expect(decision.data.count).toBe(1);
        expect(decision.data.isAbortError).toBe(true);
        expect(decision.data.backoffMs).toBe(Math.min(expectedBase, expectedMax));
        expect(decision.data.shouldFailover).toBe(false);
    });
});
