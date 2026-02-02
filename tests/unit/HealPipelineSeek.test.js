import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('HealPipelineSeek', () => {
    let seekSpy;
    let findSpy;

    afterEach(() => {
        if (seekSpy) {
            seekSpy.mockRestore();
            seekSpy = null;
        }
        if (findSpy) {
            findSpy.mockRestore();
            findSpy = null;
        }
        vi.useRealTimers();
    });

    it('retries abort errors with a fresh heal point', async () => {
        vi.useFakeTimers();

        const video = createVideo();
        const initialPoint = { start: 10, end: 12 };
        const retryPoint = { start: 20, end: 22 };

        seekSpy = vi.spyOn(window.LiveEdgeSeeker, 'seekAndPlay')
            .mockResolvedValueOnce({ success: false, errorName: 'AbortError', error: 'AbortError' })
            .mockResolvedValueOnce({ success: true });

        findSpy = vi.spyOn(window.BufferGapFinder, 'findHealPoint').mockReturnValue(retryPoint);

        const attemptLogger = {
            logRetry: vi.fn(),
            logRetrySkip: vi.fn()
        };

        const seeker = window.HealPipelineSeek.create({ attemptLogger });
        const promise = seeker.attemptSeekWithRetry(video, initialPoint);

        await vi.advanceTimersByTimeAsync(CONFIG.recovery.HEAL_RETRY_DELAY_MS);
        const result = await promise;

        expect(seekSpy).toHaveBeenCalledTimes(2);
        expect(seekSpy).toHaveBeenNthCalledWith(1, video, initialPoint);
        expect(seekSpy).toHaveBeenNthCalledWith(2, video, retryPoint);
        expect(attemptLogger.logRetry).toHaveBeenCalledWith('abort_error', retryPoint);
        expect(attemptLogger.logRetrySkip).not.toHaveBeenCalled();
        expect(result.finalPoint).toEqual(retryPoint);
        expect(result.result.success).toBe(true);
    });
});
