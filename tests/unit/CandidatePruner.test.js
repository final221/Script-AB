import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('CandidatePruner', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prunes the worst non-protected candidate when above the cap', () => {
        const stopMonitoring = vi.fn();
        const monitorsById = new Map([
            ['video-1', { video: createVideo(), monitor: { state: { state: MonitorStates.PLAYING } } }],
            ['video-2', { video: createVideo(), monitor: { state: { state: MonitorStates.PLAYING } } }],
            ['video-3', { video: createVideo(), monitor: { state: { state: MonitorStates.PLAYING } } }]
        ]);

        const scoreVideo = (video, monitor, videoId) => ({
            score: videoId === 'video-2' ? 5 : -2
        });

        const pruner = window.CandidatePruner.create({
            monitorsById,
            logDebug: () => {},
            maxMonitors: 2,
            scoreVideo,
            getActiveId: () => 'video-1',
            getLastGoodId: () => null
        });

        pruner.pruneMonitors('video-1', stopMonitoring);

        expect(stopMonitoring).toHaveBeenCalledTimes(1);
        const prunedVideo = stopMonitoring.mock.calls[0][0];
        expect(prunedVideo).toBe(monitorsById.get('video-3').video);
    });

    it('logs prune skip when all candidates are protected', () => {
        const stopMonitoring = vi.fn();
        const logDebug = vi.fn();
        const monitorsById = new Map([
            ['video-1', { video: createVideo(), monitor: { state: { state: MonitorStates.PLAYING } } }],
            ['video-2', { video: createVideo(), monitor: { state: { state: MonitorStates.PLAYING } } }],
            ['video-3', { video: createVideo(), monitor: { state: { state: MonitorStates.PLAYING } } }]
        ]);

        const pruner = window.CandidatePruner.create({
            monitorsById,
            logDebug,
            maxMonitors: 2,
            scoreVideo: () => ({ score: 0 }),
            getActiveId: () => 'video-1',
            getLastGoodId: () => 'video-2'
        });

        pruner.pruneMonitors('video-3', stopMonitoring);

        expect(stopMonitoring).not.toHaveBeenCalled();
        const skipLogs = logDebug.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.PRUNE_SKIP
        );
        expect(skipLogs.length).toBe(1);
    });
});
