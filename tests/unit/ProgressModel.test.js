import { describe, it, expect } from 'vitest';
import { createVideo, defineVideoProps } from '../helpers/video.js';

describe('ProgressModel', () => {
    it('classifies canonical progress flags from baseline/action context', () => {
        const now = 100000;
        const video = createVideo({
            paused: false,
            readyState: 4,
            currentTime: 10.3
        });
        const state = {
            hasProgress: true,
            lastProgressTime: now - 50,
            progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS + 10
        };
        const baseline = {
            actionStartMs: now - 200,
            baselineCurrentTime: 10.0,
            baselineProgressTime: now - 500
        };

        const result = ProgressModel.evaluateVideo(video, state, {
            nowMs: now,
            actionStartMs: baseline.actionStartMs,
            baselineCurrentTime: baseline.baselineCurrentTime,
            baselineProgressTime: baseline.baselineProgressTime
        });

        expect(result.raw_progress).toBe(true);
        expect(result.recent_progress).toBe(true);
        expect(result.sustained_progress).toBe(true);
        expect(result.action_progress).toBe(true);
        expect(result.action_succeeded).toBe(true);
    });

    it('rejects action progress when progress happened before action start', () => {
        const now = 200000;
        const video = createVideo({
            paused: false,
            readyState: 4,
            currentTime: 12.5
        });
        const state = {
            hasProgress: true,
            lastProgressTime: now - 300,
            progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS + 10
        };
        const baseline = {
            actionStartMs: now - 100,
            baselineCurrentTime: 12.0,
            baselineProgressTime: now - 1000
        };

        const result = ProgressModel.evaluateVideo(video, state, {
            nowMs: now,
            actionStartMs: baseline.actionStartMs,
            baselineCurrentTime: baseline.baselineCurrentTime,
            baselineProgressTime: baseline.baselineProgressTime
        });

        expect(result.recent_progress).toBe(true);
        expect(result.action_progress).toBe(false);
    });

    it('requires media-ready gate for raw/action progress', () => {
        const now = 300000;
        const video = createVideo({
            paused: true,
            readyState: 1,
            currentTime: 20.4
        });
        const state = {
            hasProgress: true,
            lastProgressTime: now - 20,
            progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS + 10
        };
        const baseline = {
            actionStartMs: now - 200,
            baselineCurrentTime: 20.0,
            baselineProgressTime: now - 500
        };

        const result = ProgressModel.evaluateVideo(video, state, {
            nowMs: now,
            actionStartMs: baseline.actionStartMs,
            baselineCurrentTime: baseline.baselineCurrentTime,
            baselineProgressTime: baseline.baselineProgressTime
        });

        expect(result.raw_progress).toBe(false);
        expect(result.action_progress).toBe(false);

        defineVideoProps(video, { paused: false, readyState: 4 });
        const recovered = ProgressModel.evaluateVideo(video, state, {
            nowMs: now,
            actionStartMs: baseline.actionStartMs,
            baselineCurrentTime: baseline.baselineCurrentTime,
            baselineProgressTime: baseline.baselineProgressTime
        });
        expect(recovered.action_progress).toBe(true);
    });
});
