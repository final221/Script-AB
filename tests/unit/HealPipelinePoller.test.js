import { describe, it, expect, vi } from 'vitest';

describe('HealPipelinePoller', () => {
    it('treats no-heal-point as recovered when playback resumes', async () => {
        const video = document.createElement('video');
        const monitorState = {};
        const poller = {
            pollForHealPoint: vi.fn().mockResolvedValue({ aborted: false, healPoint: null }),
            hasRecovered: vi.fn().mockReturnValue(true)
        };
        const attemptLogger = {
            logSelfRecovered: vi.fn(),
            logNoHealPoint: vi.fn()
        };
        const recoveryManager = { handleNoHealPoint: vi.fn() };
        const resetRecovery = vi.fn();
        const resetHealPointTracking = vi.fn();
        const getDurationMs = () => 123;

        const helpers = window.HealPipelinePoller.create({
            poller,
            attemptLogger,
            recoveryManager,
            resetRecovery,
            resetHealPointTracking,
            getDurationMs,
            onDetached: vi.fn()
        });

        const result = await helpers.pollForHealPoint(video, monitorState, 'video-1', 0);

        expect(result.status).toBe('recovered');
        expect(attemptLogger.logSelfRecovered).toHaveBeenCalledWith(123, video, 'video-1');
        expect(resetRecovery).toHaveBeenCalledWith(monitorState, 'self_recovered');
        expect(recoveryManager.handleNoHealPoint).not.toHaveBeenCalled();
        expect(resetHealPointTracking).not.toHaveBeenCalled();
    });

    it('uses HEAL_TIMEOUT_S and escalates no-heal-point outcomes', async () => {
        const video = document.createElement('video');
        const monitorState = {};
        const poller = {
            pollForHealPoint: vi.fn().mockResolvedValue({ aborted: false, healPoint: null }),
            hasRecovered: vi.fn().mockReturnValue(false)
        };
        const attemptLogger = {
            logSelfRecovered: vi.fn(),
            logNoHealPoint: vi.fn()
        };
        const recoveryManager = { handleNoHealPoint: vi.fn() };
        const resetRecovery = vi.fn();
        const resetHealPointTracking = vi.fn();
        const getDurationMs = () => 456;

        const helpers = window.HealPipelinePoller.create({
            poller,
            attemptLogger,
            recoveryManager,
            resetRecovery,
            resetHealPointTracking,
            getDurationMs,
            onDetached: vi.fn()
        });

        const result = await helpers.pollForHealPoint(video, monitorState, 'video-1', 0);

        expect(poller.pollForHealPoint).toHaveBeenCalledWith(
            video,
            monitorState,
            CONFIG.stall.HEAL_TIMEOUT_S * 1000
        );
        expect(result.status).toBe('no_point');
        expect(attemptLogger.logNoHealPoint).toHaveBeenCalledWith(456, video, 'video-1');
        expect(recoveryManager.handleNoHealPoint).toHaveBeenCalledWith(video, monitorState, 'no_heal_point');
        expect(resetHealPointTracking).toHaveBeenCalledWith(monitorState);
    });
});
