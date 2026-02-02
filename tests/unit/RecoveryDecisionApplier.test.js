import { describe, it, expect, vi } from 'vitest';

describe('RecoveryDecisionApplier', () => {
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
});
