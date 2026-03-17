import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo, setBufferedRanges } from '../helpers/video.js';

describe('PlaybackSyncLogic', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not log before the sample window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);

        const video = createVideo({ paused: false, readyState: 3, currentTime: 5 });
        const state = { lastSyncWallTime: 1000, lastSyncMediaTime: 5, lastSyncLogTime: 0 };
        const logDebugLazy = vi.fn();

        const logic = PlaybackSyncLogic.create({ video, state, logDebugLazy });
        logic.logSyncStatus();

        expect(logDebugLazy).not.toHaveBeenCalled();
    });

    it('logs when drift exceeds the configured threshold', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.monitoring.SYNC_SAMPLE_MS + 10);

        const video = createVideo({ paused: false, readyState: 3, currentTime: 0.5 });
        setBufferedRanges(video, [[0, 10]]);
        const state = { lastSyncWallTime: 1, lastSyncMediaTime: 0, lastSyncLogTime: 0 };
        const logDebugLazy = vi.fn();

        vi.spyOn(BufferGapFinder, 'getBufferRanges').mockReturnValue([{ start: 0, end: 10 }]);

        const logic = PlaybackSyncLogic.create({ video, state, logDebugLazy });
        logic.logSyncStatus();

        expect(logDebugLazy).toHaveBeenCalledTimes(1);
    });

    it('tracks degraded sync samples and clears them after recovery', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.monitoring.SYNC_SAMPLE_MS + 10);

        const video = createVideo({ paused: false, readyState: 3, currentTime: 4.3 });
        setBufferedRanges(video, [[0, 10]]);
        const state = {
            lastSyncWallTime: 1,
            lastSyncMediaTime: 0,
            lastSyncLogTime: 0,
            degradedSyncCount: 0
        };
        const logDebugLazy = vi.fn();

        const logic = PlaybackSyncLogic.create({ video, state, logDebugLazy });
        logic.logSyncStatus();

        expect(state.degradedSyncCount).toBe(1);
        expect(state.lastSyncRate).toBeLessThanOrEqual(CONFIG.monitoring.SYNC_RATE_MIN);
        expect(state.lastSyncDriftMs).toBeGreaterThan(0);

        vi.setSystemTime((CONFIG.monitoring.SYNC_SAMPLE_MS * 2) + 20);
        Object.defineProperty(video, 'currentTime', { value: 9.55, configurable: true });
        logic.logSyncStatus();

        expect(state.degradedSyncCount).toBe(0);
        expect(state.lastSyncRate).toBeGreaterThan(CONFIG.monitoring.SYNC_RATE_MIN);
    });

    it('treats severe sync collapse as immediately degraded and reports it', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.monitoring.SYNC_SAMPLE_MS + 10);

        const video = createVideo({ paused: false, readyState: 3, currentTime: 0.4 });
        setBufferedRanges(video, [[0, 8]]);
        const state = {
            lastSyncWallTime: 1,
            lastSyncMediaTime: 0,
            lastSyncLogTime: 0,
            degradedSyncCount: 0
        };
        const logDebugLazy = vi.fn();
        const onDegradedSync = vi.fn();

        const logic = PlaybackSyncLogic.create({ video, state, logDebugLazy, onDegradedSync });
        logic.logSyncStatus();

        expect(state.degradedSyncCount).toBe(CONFIG.monitoring.DEGRADED_ACTIVE_SAMPLE_COUNT);
        expect(onDegradedSync).toHaveBeenCalledWith(expect.objectContaining({
            severe: true,
            degraded: true,
            driftMs: expect.any(Number)
        }));
    });
});
