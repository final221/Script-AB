import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('StallHandler', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('debounces heal attempts after recent progress', () => {
        vi.useFakeTimers();
        const now = 100000;
        vi.setSystemTime(now);

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' }, [[0, 10]]);
        document.body.appendChild(video);

        const monitorState = {
            lastHealAttemptTime: now - (CONFIG.stall.RETRY_COOLDOWN_MS - 1),
            lastProgressTime: now - 10,
            progressEligible: true
        };

        const candidateSelector = {
            getActiveId: () => 'video-1',
            evaluateCandidates: vi.fn(),
            activateProbation: vi.fn()
        };
        const recoveryManager = {
            canRequestRefresh: vi.fn().mockReturnValue({ allow: false }),
            shouldSkipStall: vi.fn().mockReturnValue(false),
            probeCandidate: vi.fn()
        };
        const healPipeline = { attemptHeal: vi.fn() };

        const stallHandler = window.StallHandler.create({
            candidateSelector,
            recoveryManager,
            getVideoId: () => 'video-1',
            logDebug: vi.fn(),
            healPipeline,
            scanForVideos: vi.fn()
        });

        stallHandler.onStallDetected(video, {
            trigger: 'WATCHDOG',
            stalledFor: '2000ms',
            bufferExhausted: true
        }, monitorState);

        expect(healPipeline.attemptHeal).not.toHaveBeenCalled();
        expect(candidateSelector.evaluateCandidates).not.toHaveBeenCalled();
    });

    it('throttles buffer-starved rescans within the cooldown window', () => {
        vi.useFakeTimers();
        const now = 500000;
        vi.setSystemTime(now);

        const video = createVideo({ paused: false, readyState: 3, currentSrc: 'src-main' }, [[0, 5]]);
        document.body.appendChild(video);

        const monitorState = {
            bufferStarved: true,
            lastBufferStarveRescanTime: 0,
            lastBufferAhead: 0,
            lastHealAttemptTime: 0,
            lastProgressTime: 0
        };

        const candidateSelector = {
            getActiveId: () => 'video-1',
            evaluateCandidates: vi.fn(),
            activateProbation: vi.fn()
        };
        const recoveryManager = {
            canRequestRefresh: vi.fn().mockReturnValue({ allow: false }),
            shouldSkipStall: vi.fn().mockReturnValue(false),
            probeCandidate: vi.fn()
        };
        const healPipeline = { attemptHeal: vi.fn() };
        const scanForVideos = vi.fn();

        vi.spyOn(MediaState, 'bufferAhead').mockReturnValue({ bufferAhead: 0, hasBuffer: false });

        const stallHandler = window.StallHandler.create({
            candidateSelector,
            recoveryManager,
            getVideoId: () => 'video-1',
            logDebug: vi.fn(),
            healPipeline,
            scanForVideos
        });

        stallHandler.onStallDetected(video, {
            trigger: 'WATCHDOG',
            stalledFor: '4000ms',
            bufferExhausted: true
        }, monitorState);

        expect(candidateSelector.activateProbation).toHaveBeenCalledWith('buffer_starved');
        expect(scanForVideos).toHaveBeenCalledTimes(1);

        vi.setSystemTime(now + CONFIG.stall.BUFFER_STARVE_RESCAN_COOLDOWN_MS - 1);
        stallHandler.onStallDetected(video, {
            trigger: 'WATCHDOG',
            stalledFor: '5000ms',
            bufferExhausted: true
        }, monitorState);

        expect(scanForVideos).toHaveBeenCalledTimes(1);
    });
});
