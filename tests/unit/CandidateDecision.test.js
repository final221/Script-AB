import { describe, it, expect, vi } from 'vitest';

describe('CandidateDecision', () => {
    it('delegates to the switch policy when provided', () => {
        const decide = vi.fn().mockReturnValue({ action: 'switch', toId: 'video-2' });
        const decision = CandidateDecision.create({ switchPolicy: { decide } });
        const context = { reason: 'test' };

        const result = decision.decide(context);

        expect(decide).toHaveBeenCalledWith(context);
        expect(result.action).toBe('switch');
        expect(result.toId).toBe('video-2');
    });

    it('builds a default decision when no switch policy exists', () => {
        const decision = CandidateDecision.create();
        const context = {
            reason: 'interval',
            activeCandidateId: 'video-1',
            preferred: { id: 'video-2' },
            scores: [{ id: 'video-1' }, { id: 'video-2' }]
        };

        const result = decision.decide(context);

        expect(result).toEqual({
            action: 'none',
            reason: 'interval',
            fromId: 'video-1',
            toId: 'video-2',
            preferred: context.preferred,
            scores: context.scores
        });
    });
});
