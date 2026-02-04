import { describe, it, expect, vi, afterEach } from 'vitest';

describe('HealPointPoller', () => {
    let findSpy;
    let analyzeSpy;
    let addSpy;

    afterEach(() => {
        if (findSpy) {
            findSpy.mockRestore();
            findSpy = null;
        }
        if (analyzeSpy) {
            analyzeSpy.mockRestore();
            analyzeSpy = null;
        }
        if (addSpy) {
            addSpy.mockRestore();
            addSpy = null;
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

    it('allows low-headroom heals when buffer is exhausted via gap override', async () => {
        const video = document.createElement('video');
        const monitorState = {
            lastProgressTime: Date.now() - CONFIG.stall.RECOVERY_WINDOW_MS - 1000
        };
        const healPoint = {
            start: 10,
            end: 10.6,
            gapSize: 0.4,
            isNudge: false,
            rangeIndex: 1
        };

        findSpy = vi.spyOn(window.BufferGapFinder, 'findHealPoint').mockReturnValue(healPoint);
        analyzeSpy = vi.spyOn(window.BufferGapFinder, 'analyze').mockReturnValue({
            bufferExhausted: true,
            formattedRanges: '[0.00-10.60]'
        });
        addSpy = vi.spyOn(Logger, 'add').mockImplementation(() => {});

        const poller = window.HealPointPoller.create({
            getVideoId: () => 'video-1',
            logWithState: vi.fn(),
            logDebug: vi.fn()
        });

        const result = await poller.pollForHealPoint(video, monitorState, 2000);

        expect(result.healPoint).toEqual(healPoint);
        const gapOverrideLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.GAP_OVERRIDE
        );
        expect(gapOverrideLogs.length).toBe(1);
    });

    it('rejects low-headroom heals when gap override thresholds are not met', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const originalDeferAbort = CONFIG.recovery.HEAL_DEFER_ABORT_MS;
        CONFIG.recovery.HEAL_DEFER_ABORT_MS = 1;

        const video = document.createElement('video');
        const monitorState = {
            lastProgressTime: -CONFIG.stall.RECOVERY_WINDOW_MS - 1000
        };
        const healPoint = {
            start: 10,
            end: 10.5,
            gapSize: 0.1,
            isNudge: false,
            rangeIndex: 1
        };

        findSpy = vi.spyOn(window.BufferGapFinder, 'findHealPoint').mockReturnValue(healPoint);
        analyzeSpy = vi.spyOn(window.BufferGapFinder, 'analyze').mockReturnValue({
            bufferExhausted: false,
            formattedRanges: 'none'
        });

        const poller = window.HealPointPoller.create({
            getVideoId: () => 'video-1',
            logWithState: vi.fn(),
            logDebug: vi.fn()
        });

        try {
            const promise = poller.pollForHealPoint(video, monitorState, 2000);

            await vi.advanceTimersByTimeAsync(
                CONFIG.recovery.HEAL_DEFER_ABORT_MS + (CONFIG.stall.HEAL_POLL_INTERVAL_MS * 2)
            );

            const result = await promise;

            expect(result.healPoint).toBeNull();
            expect(result.aborted).toBe(false);
            expect(findSpy).toHaveBeenCalled();
        } finally {
            CONFIG.recovery.HEAL_DEFER_ABORT_MS = originalDeferAbort;
        }
    });

    it('skips healing when recent progress indicates self-recovery', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);

        const video = document.createElement('video');
        const monitorState = {
            lastProgressTime: Date.now() - (CONFIG.stall.RECOVERY_WINDOW_MS - 100)
        };

        findSpy = vi.spyOn(window.BufferGapFinder, 'findHealPoint').mockReturnValue({
            start: 10,
            end: 12
        });

        const poller = window.HealPointPoller.create({
            getVideoId: () => 'video-1',
            logWithState: vi.fn(),
            logDebug: vi.fn()
        });

        const result = await poller.pollForHealPoint(video, monitorState, 2000);

        expect(result.healPoint).toBeNull();
        expect(result.aborted).toBe(false);
        expect(findSpy).not.toHaveBeenCalled();
    });
});
