import { describe, it, expect, vi, afterEach } from 'vitest';

describe('HealPointPoller', () => {
    let findSpy;
    let analyzeSpy;

    afterEach(() => {
        if (findSpy) {
            findSpy.mockRestore();
            findSpy = null;
        }
        if (analyzeSpy) {
            analyzeSpy.mockRestore();
            analyzeSpy = null;
        }
        vi.useRealTimers();
    });

    it('treats repeated low-headroom heals as no-heal after defer limit', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const video = document.createElement('video');
        const monitorState = {};

        findSpy = vi.spyOn(window.BufferGapFinder, 'findHealPoint').mockReturnValue({
            start: 10,
            end: 10.5,
            gapSize: 0,
            isNudge: true,
            rangeIndex: 0
        });
        analyzeSpy = vi.spyOn(window.BufferGapFinder, 'analyze').mockReturnValue({
            bufferExhausted: false,
            formattedRanges: 'none'
        });

        const poller = window.HealPointPoller.create({
            getVideoId: () => 'video-1',
            logWithState: vi.fn(),
            logDebug: vi.fn()
        });

        const promise = poller.pollForHealPoint(
            video,
            monitorState,
            CONFIG.recovery.HEAL_DEFER_ABORT_MS + 1000
        );

        await vi.advanceTimersByTimeAsync(
            CONFIG.recovery.HEAL_DEFER_ABORT_MS + (CONFIG.stall.HEAL_POLL_INTERVAL_MS * 2)
        );

        const result = await promise;

        expect(result.healPoint).toBeNull();
        expect(result.aborted).toBe(false);
        expect(result.reason).toBe('defer_limit');
        expect(findSpy).toHaveBeenCalled();
        expect(monitorState.healDeferSince).toBe(0);
    });
});
