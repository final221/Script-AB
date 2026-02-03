import { describe, it, expect } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('StallSkipPolicy', () => {
    const createPolicy = (backoffStatus = { shouldSkip: false }) => {
        const backoffManager = {
            getBackoffStatus: () => backoffStatus
        };
        return window.StallSkipPolicy.create({ backoffManager });
    };

    it('skips when quiet window is active', () => {
        const policy = createPolicy();
        const now = 10000;
        const monitorState = { noHealPointQuietUntil: now + 500 };
        const video = createVideo();

        const decision = policy.decide({ video, monitorState, now, videoId: 'video-1' });

        expect(decision.data.shouldSkip).toBe(true);
        expect(decision.data.reason).toBe('quiet');
    });

    it('skips when backoff manager blocks healing', () => {
        const backoff = { shouldSkip: true, remainingMs: 1000, noHealPointCount: 2 };
        const policy = createPolicy(backoff);
        const now = 20000;
        const monitorState = {};
        const video = createVideo();

        const decision = policy.decide({ video, monitorState, now, videoId: 'video-1' });

        expect(decision.data.shouldSkip).toBe(true);
        expect(decision.data.reason).toBe('backoff');
        expect(decision.data.backoff.remainingMs).toBe(1000);
    });

    it('skips when buffer starvation window is active', () => {
        const policy = createPolicy();
        const now = 30000;
        const monitorState = { bufferStarveUntil: now + 1000, lastBufferAhead: 0.2 };
        const video = createVideo();

        const decision = policy.decide({ video, monitorState, now, videoId: 'video-1' });

        expect(decision.data.shouldSkip).toBe(true);
        expect(decision.data.reason).toBe('buffer_starve');
        expect(decision.data.bufferStarve.remainingMs).toBe(1000);
    });

    it('skips when play backoff is active', () => {
        const policy = createPolicy();
        const now = 40000;
        const monitorState = { nextPlayHealAllowedTime: now + 800, playErrorCount: 2 };
        const video = createVideo();

        const decision = policy.decide({ video, monitorState, now, videoId: 'video-1' });

        expect(decision.data.shouldSkip).toBe(true);
        expect(decision.data.reason).toBe('play_backoff');
        expect(decision.data.playBackoff.remainingMs).toBe(800);
    });

    it('skips when self-recover signals are present', () => {
        const policy = createPolicy();
        const now = 50000;
        const monitorState = {
            lastProgressTime: now - 2000,
            lastReadyStateChangeTime: now - 200,
            lastBufferAhead: 0.5,
            bufferStarved: false
        };
        const video = createVideo();

        const decision = policy.decide({ video, monitorState, now, videoId: 'video-1' });

        expect(decision.data.shouldSkip).toBe(true);
        expect(decision.data.reason).toBe('self_recover');
        expect(decision.data.selfRecover.signals).toContain('ready_state');
    });
});
