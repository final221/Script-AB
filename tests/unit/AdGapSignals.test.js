import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo, setBufferedRanges } from '../helpers/video.js';

describe('AdGapSignals', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when playhead is not near the buffered edge', () => {
        const ranges = [
            { start: 0, end: 10 },
            { start: 15, end: 20 }
        ];

        const detection = AdGapSignals.detectGap(ranges, 8, 0.3);

        expect(detection).toBeNull();
    });

    it('throttles repeated ad-gap logs within the backoff interval', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const video = createVideo({ currentTime: 9.9 });
        setBufferedRanges(video, [[0, 10], [15, 20]]);
        const monitorState = { lastAdGapSignatureLogTime: 0 };
        const now = 100000;

        const first = AdGapSignals.maybeLog({
            video,
            videoId: 'video-1',
            monitorState,
            playheadSeconds: 9.9,
            now
        });

        const second = AdGapSignals.maybeLog({
            video,
            videoId: 'video-1',
            monitorState,
            playheadSeconds: 9.9,
            now: now + CONFIG.logging.BACKOFF_LOG_INTERVAL_MS - 1
        });

        expect(first).not.toBeNull();
        expect(second).toBeNull();
        expect(addSpy).toHaveBeenCalledTimes(1);
    });
});
