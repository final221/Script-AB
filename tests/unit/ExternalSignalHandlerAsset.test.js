import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

const createHarness = (overrides = {}) => {
    const videoA = createVideo({ paused: true, readyState: 1, currentSrc: 'src-a' });
    const videoB = createVideo({ paused: true, readyState: 1, currentSrc: 'src-b' });
    const videoC = createVideo({ paused: true, readyState: 1, currentSrc: 'src-c' });
    videoA.play = vi.fn().mockResolvedValue();
    videoB.play = vi.fn().mockResolvedValue();
    videoC.play = vi.fn().mockResolvedValue();

    const monitorA = { state: { hasProgress: false, lastProgressTime: 0 } };
    const monitorB = { state: { hasProgress: false, lastProgressTime: 0 } };
    const monitorC = { state: { hasProgress: false, lastProgressTime: 0 } };

    const monitorsById = new Map([
        ['video-1', { video: videoA, monitor: monitorA }],
        ['video-2', { video: videoB, monitor: monitorB }],
        ['video-3', { video: videoC, monitor: monitorC }]
    ]);

    let activeId = overrides.activeId || 'video-1';
    const scoreMap = overrides.scoreMap || {
        'video-1': { score: 5, deadCandidate: false, progressEligible: true, trusted: true, vs: { readyState: 3, currentSrc: 'src-a', src: 'src-a' } },
        'video-2': { score: 9, deadCandidate: false, progressEligible: true, trusted: true, vs: { readyState: 3, currentSrc: 'src-b', src: 'src-b' } },
        'video-3': { score: 4, deadCandidate: false, progressEligible: false, trusted: false, vs: { readyState: 0, currentSrc: '', src: '' } }
    };

    const candidateSelector = {
        activateProbation: vi.fn(),
        evaluateCandidates: vi.fn(),
        scoreVideo: vi.fn((video, monitor, videoId) => scoreMap[videoId]),
        getActiveId: vi.fn(() => activeId),
        setActiveId: vi.fn((nextId) => {
            activeId = nextId;
        })
    };

    const recoveryManager = {
        isFailoverActive: vi.fn(() => false),
        probeCandidate: vi.fn(() => true),
        canRequestRefresh: vi.fn(() => ({ allow: true, reason: 'ok' })),
        requestRefresh: vi.fn(() => true)
    };

    const onRescan = vi.fn();
    const logDebug = vi.fn();
    const handler = window.ExternalSignalHandlerAsset.create({
        monitorsById,
        candidateSelector,
        recoveryManager,
        logDebug,
        onRescan
    });

    const helpers = {
        truncateMessage: (message) => message,
        logCandidateSnapshot: vi.fn(),
        probeCandidates: vi.fn()
    };

    return {
        handler,
        helpers,
        monitorsById,
        candidateSelector,
        recoveryManager,
        onRescan,
        logDebug,
        getActiveId: () => activeId
    };
};

describe('ExternalSignalHandlerAsset', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        Logger.getLogs().length = 0;
        document.body.innerHTML = '';
    });

    it('skips processing-asset recovery when failover is active', async () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const harness = createHarness();
        harness.recoveryManager.isFailoverActive.mockReturnValue(true);

        const result = harness.handler({ level: 'error', message: 'processing asset' }, harness.helpers);
        expect(result).toBe(true);

        await flushMicrotasks();

        expect(harness.candidateSelector.evaluateCandidates).not.toHaveBeenCalled();
        expect(harness.recoveryManager.probeCandidate).not.toHaveBeenCalled();
        expect(harness.recoveryManager.requestRefresh).not.toHaveBeenCalled();
        expect(harness.helpers.logCandidateSnapshot).toHaveBeenCalledTimes(1);
        expect(harness.onRescan).toHaveBeenCalledTimes(1);
        const skipLogged = addSpy.mock.calls.some((call) => (
            call[0]?.detail?.message === 'Processing asset recovery skipped during failover'
        ));
        expect(skipLogged).toBe(true);
    });

    it('completes recovery in strict candidate pass when candidate progresses', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);
        const addSpy = vi.spyOn(Logger, 'add');
        const harness = createHarness({
            scoreMap: {
                'video-1': { score: 5, deadCandidate: false, progressEligible: true, trusted: true, vs: { readyState: 3, currentSrc: 'src-a', src: 'src-a' } },
                'video-2': { score: 10, deadCandidate: false, progressEligible: true, trusted: true, vs: { readyState: 4, currentSrc: 'src-b', src: 'src-b' } },
                'video-3': { score: 2, deadCandidate: true, progressEligible: false, trusted: false, vs: { readyState: 0, currentSrc: '', src: '' } }
            }
        });

        setTimeout(() => {
            const state = harness.monitorsById.get('video-2').monitor.state;
            state.hasProgress = true;
            state.lastProgressTime = Date.now();
        }, 300);

        harness.handler({ level: 'warn', message: 'processing asset' }, harness.helpers);
        await vi.advanceTimersByTimeAsync(700);

        expect(harness.candidateSelector.setActiveId).toHaveBeenCalledWith('video-2');
        expect(harness.recoveryManager.probeCandidate).not.toHaveBeenCalled();
        expect(harness.recoveryManager.requestRefresh).not.toHaveBeenCalled();
        const messages = addSpy.mock.calls.map((call) => call[0]?.detail?.message);
        expect(messages).toContain('Strict candidate pass applied');
        expect(messages).toContain('Strict candidate verified progress, recovery completed');
    });

    it('switches to a probing candidate when probe window finds progress', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(200000);
        const addSpy = vi.spyOn(Logger, 'add');
        const harness = createHarness({
            scoreMap: {
                'video-1': { score: 5, deadCandidate: false, progressEligible: true, trusted: true, vs: { readyState: 3, currentSrc: 'src-a', src: 'src-a' } },
                'video-2': { score: 9, deadCandidate: false, progressEligible: false, trusted: false, vs: { readyState: 1, currentSrc: '', src: '' } },
                'video-3': { score: 8, deadCandidate: false, progressEligible: false, trusted: false, vs: { readyState: 0, currentSrc: '', src: '' } }
            }
        });

        setTimeout(() => {
            const state = harness.monitorsById.get('video-3').monitor.state;
            state.hasProgress = true;
            state.lastProgressTime = Date.now();
        }, 700);

        harness.handler({ level: 'warn', message: 'processing asset' }, harness.helpers);
        await vi.advanceTimersByTimeAsync(1400);

        expect(harness.recoveryManager.probeCandidate).toHaveBeenCalledWith('video-2', 'processing_asset');
        expect(harness.recoveryManager.probeCandidate).toHaveBeenCalledWith('video-3', 'processing_asset');
        expect(harness.candidateSelector.setActiveId).toHaveBeenCalledWith('video-3');
        expect(harness.recoveryManager.requestRefresh).not.toHaveBeenCalled();
        const messages = addSpy.mock.calls.map((call) => call[0]?.detail?.message);
        expect(messages).toContain('Fast probe pass started');
        expect(messages).toContain('Fast probe pass found progressing candidate');
    });

    it('runs speculative fallback then reverts and refreshes when no progress is found', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(300000);
        const addSpy = vi.spyOn(Logger, 'add');
        const harness = createHarness({
            scoreMap: {
                'video-1': { score: 4, deadCandidate: false, progressEligible: true, trusted: true, vs: { readyState: 3, currentSrc: 'src-a', src: 'src-a' } },
                'video-2': { score: 10, deadCandidate: false, progressEligible: false, trusted: false, vs: { readyState: 1, currentSrc: '', src: '' } },
                'video-3': { score: 7, deadCandidate: false, progressEligible: false, trusted: false, vs: { readyState: 0, currentSrc: '', src: '' } }
            }
        });

        harness.handler({ level: 'warn', message: 'processing asset' }, harness.helpers);
        await vi.advanceTimersByTimeAsync(2600);

        expect(harness.candidateSelector.setActiveId).toHaveBeenCalledWith('video-2');
        expect(harness.candidateSelector.setActiveId).toHaveBeenCalledWith('video-1');
        expect(harness.recoveryManager.requestRefresh).toHaveBeenCalledWith(
            'video-1',
            harness.monitorsById.get('video-1').monitor.state,
            expect.objectContaining({
                reason: 'processing_asset_exhausted',
                trigger: 'processing_asset',
                detail: 'no_candidate_progress'
            })
        );

        const messages = addSpy.mock.calls.map((call) => call[0]?.detail?.message);
        expect(messages).toContain('Speculative fallback switch applied');
        expect(messages).toContain('Speculative fallback candidate failed to progress, reverting');
        expect(messages).toContain('Speculative fallback reverted to previous active candidate');
        expect(messages).toContain('Processing asset recovery exhausted, refresh decision applied');
    });
});
