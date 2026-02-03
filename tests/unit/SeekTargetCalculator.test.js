import { describe, it, expect } from 'vitest';

describe('SeekTargetCalculator', () => {
    it('keeps small-buffer targets inside the edge guard', () => {
        const edgeGuard = CONFIG.recovery.HEAL_EDGE_GUARD_S;
        const healPoint = { start: 0, end: 0.6 };

        const target = SeekTargetCalculator.calculateSafeTarget(healPoint);

        expect(target).toBeGreaterThanOrEqual(healPoint.start);
        expect(target).toBeLessThanOrEqual(healPoint.end - edgeGuard);
    });

    it('preserves at least one second of headroom when buffer is large enough', () => {
        const healPoint = { start: 0, end: 1.4 };

        const target = SeekTargetCalculator.calculateSafeTarget(healPoint);
        const headroom = healPoint.end - target;

        expect(headroom).toBeGreaterThanOrEqual(1);
        expect(target).toBeLessThanOrEqual(healPoint.end - CONFIG.recovery.HEAL_EDGE_GUARD_S);
    });

    it('returns the matching buffer range for valid targets', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'buffered', {
            value: {
                length: 2,
                start: (i) => (i === 0 ? 0 : 10),
                end: (i) => (i === 0 ? 5 : 15)
            },
            configurable: true
        });

        const result = SeekTargetCalculator.validateSeekTarget(video, 12);

        expect(result.valid).toBe(true);
        expect(result.bufferRange).toEqual({ start: 10, end: 15 });
        expect(result.headroom).toBe(3);
    });
});
