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
