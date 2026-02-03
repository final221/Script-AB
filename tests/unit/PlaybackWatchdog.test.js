import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackWatchdog', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('invokes onStall after the confirm window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);

        const video = createVideo({ paused: false, readyState: 3, currentTime: 10 });
        document.body.appendChild(video);

        const state = PlaybackStateStore.create(video);
        state.firstSeenTime = 0;
        state.lastProgressTime = 100000 - (CONFIG.stall.STALL_CONFIRM_MS + CONFIG.stall.STALL_CONFIRM_BUFFER_OK_MS + 10);

        const tracker = {
            evaluateResetPending: vi.fn(),
            shouldSkipUntilProgress: vi.fn(() => false),
            updateBufferStarvation: vi.fn(),
            logSyncStatus: vi.fn()
        };
        const stallMachine = {
            handleWatchdogPause: vi.fn(() => ({ pauseFromStall: false, shouldReturn: false })),
            handleWatchdogNoProgress: vi.fn()
        };
        const onStall = vi.fn();

        vi.spyOn(MediaState, 'isBufferExhausted').mockReturnValue(false);
        vi.spyOn(MediaState, 'bufferAhead').mockReturnValue({ bufferAhead: 0, hasBuffer: false });

        const watchdog = PlaybackWatchdog.create({
            video,
            videoId: 'video-1',
            logDebug: vi.fn(),
            tracker,
            state,
            stallMachine,
            isHealing: () => false,
            isActive: () => true,
            onRemoved: vi.fn(),
            onStall
        });

        watchdog.start();
        vi.advanceTimersByTime(CONFIG.stall.WATCHDOG_INTERVAL_MS + 1);

        expect(onStall).toHaveBeenCalledTimes(1);
        const [detail] = onStall.mock.calls[0];
        expect(detail.trigger).toBe('WATCHDOG');
        expect(detail.bufferExhausted).toBe(false);

        watchdog.stop();
    });
});
