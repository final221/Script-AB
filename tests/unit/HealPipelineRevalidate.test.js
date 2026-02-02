import { describe, it, expect, vi, afterEach } from 'vitest';

describe('HealPipelineRevalidate', () => {
    let originalFindHealPoint;

    afterEach(() => {
        if (originalFindHealPoint) {
            window.BufferGapFinder.findHealPoint = originalFindHealPoint;
            originalFindHealPoint = null;
        }
    });

    it('marks stale_gone when revalidation finds no heal point', () => {
        const video = document.createElement('video');
        const monitorState = {};
        const poller = { hasRecovered: vi.fn().mockReturnValue(false) };
        const attemptLogger = { logStaleGone: vi.fn(), logPointUpdated: vi.fn() };
        const recoveryManager = { handleNoHealPoint: vi.fn() };
        const resetRecovery = vi.fn();
        const resetHealPointTracking = vi.fn();
        const getDurationMs = () => 456;

        originalFindHealPoint = window.BufferGapFinder.findHealPoint;
        window.BufferGapFinder.findHealPoint = () => null;

        const helpers = window.HealPipelineRevalidate.create({
            poller,
            attemptLogger,
            recoveryManager,
            resetRecovery,
            resetHealPointTracking,
            getDurationMs
        });

        const healPoint = { start: 10, end: 20 };
        const result = helpers.revalidateHealPoint(video, monitorState, 'video-1', healPoint, 0);

        expect(result.status).toBe('stale_gone');
        expect(attemptLogger.logStaleGone).toHaveBeenCalledWith(healPoint, video, 'video-1');
        expect(recoveryManager.handleNoHealPoint).toHaveBeenCalledWith(video, monitorState, 'stale_gone');
        expect(resetHealPointTracking).toHaveBeenCalledWith(monitorState);
        expect(resetRecovery).not.toHaveBeenCalled();
    });
});
