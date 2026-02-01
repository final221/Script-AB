import { describe, it, expect, vi, afterEach } from 'vitest';

describe('BackoffManager', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('clamps backoff and skips until next allowed time', () => {
        vi.useFakeTimers();
        const now = new Date('2026-02-01T00:00:00Z');
        vi.setSystemTime(now);

        const manager = BackoffManager.create({ logDebug: vi.fn() });
        const state = { noHealPointCount: 0, nextHealAllowedTime: 0, lastBackoffLogTime: 0 };

        const base = CONFIG.stall.NO_HEAL_POINT_BACKOFF_BASE_MS;
        const max = CONFIG.stall.NO_HEAL_POINT_BACKOFF_MAX_MS;

        for (let i = 0; i < 20; i++) {
            manager.applyBackoff('video-1', state, 'no_point');
        }

        expect(state.noHealPointCount).toBe(20);
        expect(state.nextHealAllowedTime).toBe(now.getTime() + Math.min(base * 20, max));
        expect(manager.shouldSkip('video-1', state)).toBe(true);

        vi.setSystemTime(new Date(now.getTime() + max + 1));
        expect(manager.shouldSkip('video-1', state)).toBe(false);
    });
});
