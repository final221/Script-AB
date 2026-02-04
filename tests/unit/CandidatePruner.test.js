import { describe, it, expect, vi } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('CandidatePruner', () => {
    it('prunes the lowest-score non-protected candidate when over cap', () => {
        const videoA = createVideo({ currentSrc: 'src-a' });
        const videoB = createVideo({ currentSrc: 'src-b' });
        const videoC = createVideo({ currentSrc: 'src-c' });

        const monitorsById = new Map([
            ['video-1', { video: videoA, monitor: { state: {} } }],
            ['video-2', { video: videoB, monitor: { state: {} } }],
            ['video-3', { video: videoC, monitor: { state: {} } }]
        ]);

        const scores = {
            'video-1': 10,
            'video-2': 1,
            'video-3': 5
        };

        const pruner = window.CandidatePruner.create({
            monitorsById,
            logDebug: vi.fn(),
            maxMonitors: 2,
            scoreVideo: (_video, _monitor, videoId) => ({ score: scores[videoId] }),
            getActiveId: () => 'video-1',
            getLastGoodId: () => 'video-3'
        });

        const stopMonitoring = vi.fn();

        pruner.pruneMonitors('video-4', stopMonitoring);

        expect(stopMonitoring).toHaveBeenCalledWith(videoB);
    });
});
