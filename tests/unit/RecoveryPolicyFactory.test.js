import { describe, it, expect, vi, afterEach } from 'vitest';

describe('RecoveryPolicyFactory', () => {
    const originals = {};

    const stash = (name) => {
        originals[name] = window[name].create;
    };

    const restore = (name) => {
        window[name].create = originals[name];
    };

    afterEach(() => {
        ['BackoffManager', 'ProbationPolicy', 'RecoveryDecisionApplier',
            'NoHealPointPolicy', 'PlayErrorPolicy', 'StallSkipPolicy'].forEach(restore);
    });

    it('routes policy decisions through the decision applier', () => {
        stash('BackoffManager');
        stash('ProbationPolicy');
        stash('RecoveryDecisionApplier');
        stash('NoHealPointPolicy');
        stash('PlayErrorPolicy');
        stash('StallSkipPolicy');

        const applyDecision = vi.fn((decision) => decision);
        const noHealDecision = { action: 'no_heal' };
        const playErrorDecision = { action: 'play_error' };
        const stallSkipDecision = { action: 'skip' };

        window.BackoffManager.create = vi.fn(() => ({ resetBackoff: vi.fn() }));
        window.ProbationPolicy.create = vi.fn(() => ({ id: 'probation' }));
        window.RecoveryDecisionApplier.create = vi.fn(() => ({ applyDecision }));
        window.NoHealPointPolicy.create = vi.fn(() => ({ decide: vi.fn(() => noHealDecision) }));
        window.PlayErrorPolicy.create = vi.fn(() => ({ decide: vi.fn(() => playErrorDecision), resetPlayError: vi.fn() }));
        window.StallSkipPolicy.create = vi.fn(() => ({ decide: vi.fn(() => stallSkipDecision) }));

        const policy = RecoveryPolicyFactory.create({
            candidateSelector: {},
            monitorsById: new Map(),
            getVideoId: vi.fn()
        });

        policy.handleNoHealPoint({ id: 'ctx' }, 'reason');
        policy.handlePlayFailure({ id: 'ctx' }, { reason: 'play_error' });
        policy.shouldSkipStall({ id: 'ctx' });

        expect(applyDecision).toHaveBeenCalledWith(noHealDecision);
        expect(applyDecision).toHaveBeenCalledWith(playErrorDecision);
        expect(applyDecision).toHaveBeenCalledWith(stallSkipDecision);
        expect(policy.policies).toMatchObject({
            probation: { id: 'probation' }
        });
    });
});
