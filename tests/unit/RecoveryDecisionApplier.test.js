import { describe, it, expect, vi, afterEach } from 'vitest';

describe('RecoveryDecisionApplier', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('quiets repeated no-heal-point decisions before emergency actions', () => {
        const monitorState = { noHealPointCount: 3 };
        const backoffManager = { applyBackoff: vi.fn() };
        const candidateSelector = { selectEmergencyCandidate: vi.fn() };
        const probationPolicy = { maybeTriggerProbation: vi.fn(), triggerRescanForKey: vi.fn() };
        const applier = window.RecoveryDecisionApplier.create({
            backoffManager,
            candidateSelector,
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure: () => {},
            probationPolicy
        });
        const now = Date.now();

        const decision = {
            type: 'no_heal_point',
            context: {
                videoId: 'video-1',
                monitorState,
                reason: 'no_heal_point',
                now
            },
            data: {
                quietEligible: true,
                quietUntil: now + 5000,
                shouldFailover: true,
                refreshEligible: true,
                emergencyEligible: true,
                lastResortEligible: true
            }
        };

        const result = applier.applyNoHealPointDecision(decision);

        expect(backoffManager.applyBackoff).toHaveBeenCalled();
        expect(monitorState.noHealPointQuietUntil).toBe(decision.data.quietUntil);
        expect(monitorState.nextHealAllowedTime).toBe(decision.data.quietUntil);
        expect(candidateSelector.selectEmergencyCandidate).not.toHaveBeenCalled();
        expect(probationPolicy.maybeTriggerProbation).not.toHaveBeenCalled();
        expect(result.shouldFailover).toBe(false);
        expect(result.refreshed).toBe(false);
        expect(result.emergencySwitched).toBe(false);
    });

    it('refreshes when eligible and no emergency switch occurs', () => {
        const monitorState = { noHealPointCount: 2, lastRefreshAt: 0 };
        const backoffManager = { applyBackoff: vi.fn() };
        const onPersistentFailure = vi.fn();
        const applier = window.RecoveryDecisionApplier.create({
            backoffManager,
            candidateSelector: { selectEmergencyCandidate: vi.fn() },
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure,
            probationPolicy: { maybeTriggerProbation: vi.fn() }
        });
        const now = 50000;

        const decision = {
            type: 'no_heal_point',
            context: { videoId: 'video-1', monitorState, reason: 'no_heal_point', now },
            data: {
                refreshEligible: true,
                emergencyEligible: false,
                lastResortEligible: false,
                shouldFailover: false,
                probationEligible: false,
                shouldRescanNoBuffer: false
            }
        };

        const result = applier.applyNoHealPointDecision(decision);

        expect(result.refreshed).toBe(true);
        expect(monitorState.lastRefreshAt).toBe(now);
        expect(monitorState.noHealPointCount).toBe(0);
        expect(monitorState.noHealPointRefreshUntil).toBe(0);
        expect(onPersistentFailure).toHaveBeenCalledTimes(1);
    });

    it('routes no-buffer rescans through probation policy when available', () => {
        const monitorState = { noHealPointCount: 1 };
        const backoffManager = { applyBackoff: vi.fn() };
        const candidateSelector = { activateProbation: vi.fn() };
        const probationPolicy = { triggerRescanForKey: vi.fn(), maybeTriggerProbation: vi.fn() };
        const applier = window.RecoveryDecisionApplier.create({
            backoffManager,
            candidateSelector,
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure: () => {},
            probationPolicy
        });

        const decision = {
            type: 'no_heal_point',
            context: { videoId: 'video-1', monitorState, reason: 'no_heal_point', now: 123 },
            data: {
                shouldRescanNoBuffer: true,
                refreshEligible: false,
                emergencyEligible: false,
                lastResortEligible: false,
                probationEligible: false,
                shouldFailover: false
            }
        };

        applier.applyNoHealPointDecision(decision);

        expect(probationPolicy.triggerRescanForKey).toHaveBeenCalledWith(
            'no_buffer:video-1',
            'no_buffer',
            expect.objectContaining({ videoId: 'video-1', bufferRanges: 'none' })
        );
        expect(candidateSelector.activateProbation).not.toHaveBeenCalled();
    });

    it('sets play-error backoff when play failures occur', () => {
        const monitorState = { playErrorCount: 0, nextPlayHealAllowedTime: 0 };
        const applier = window.RecoveryDecisionApplier.create({
            backoffManager: { applyBackoff: vi.fn() },
            candidateSelector: { selectEmergencyCandidate: vi.fn() },
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure: () => {},
            probationPolicy: {
                maybeTriggerProbation: vi.fn().mockReturnValue(false),
                triggerRescan: vi.fn()
            }
        });
        const now = 200000;

        const decision = {
            type: 'play_error',
            context: { videoId: 'video-1', monitorState, now },
            data: {
                count: 2,
                backoffMs: 5000,
                now,
                isAbortError: false,
                reason: 'play_error'
            }
        };

        applier.applyPlayFailureDecision(decision);

        expect(monitorState.playErrorCount).toBe(2);
        expect(monitorState.nextPlayHealAllowedTime).toBe(now + 5000);
    });

    it('logs healpoint stuck when repeat failures exceed the threshold', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const monitorState = {};
        const applier = window.RecoveryDecisionApplier.create({
            backoffManager: { applyBackoff: vi.fn() },
            candidateSelector: { selectEmergencyCandidate: vi.fn() },
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure: () => {},
            probationPolicy: {
                maybeTriggerProbation: vi.fn().mockReturnValue(false),
                triggerRescan: vi.fn()
            }
        });

        const decision = {
            type: 'play_error',
            context: { videoId: 'video-1', monitorState, now: 1000 },
            data: {
                count: 1,
                backoffMs: 1000,
                now: 1000,
                repeatStuck: true,
                healPointRepeatCount: CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT,
                errorName: 'AbortError'
            }
        };

        applier.applyPlayFailureDecision(decision);

        const stuckLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.HEALPOINT_STUCK
        );
        expect(stuckLogs.length).toBe(1);
    });

    it('rescans when healpoint repeats are stuck and probation is not triggered', () => {
        const triggerRescan = vi.fn();
        const probationPolicy = {
            maybeTriggerProbation: vi.fn().mockReturnValue(false),
            triggerRescan
        };
        const monitorState = {};
        const applier = window.RecoveryDecisionApplier.create({
            backoffManager: { applyBackoff: vi.fn() },
            candidateSelector: { selectEmergencyCandidate: vi.fn() },
            logDebug: () => {},
            onRescan: () => {},
            onPersistentFailure: () => {},
            probationPolicy
        });

        const decision = {
            type: 'play_error',
            context: { videoId: 'video-1', monitorState, now: 5000 },
            data: {
                count: 2,
                backoffMs: 2000,
                now: 5000,
                repeatStuck: true,
                healPointRepeatCount: CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT
            }
        };

        applier.applyPlayFailureDecision(decision);

        expect(triggerRescan).toHaveBeenCalledWith('healpoint_stuck', {
            videoId: 'video-1',
            count: CONFIG.stall.HEALPOINT_REPEAT_FAILOVER_COUNT,
            trigger: 'healpoint_stuck'
        });
    });
});
