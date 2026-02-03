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
});
