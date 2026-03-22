import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('PlaybackProgressReset', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears heal and play backoff state on progress', () => {
        vi.useFakeTimers();
        vi.setSystemTime(30000);

        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const reset = PlaybackProgressReset.create({
            state,
            logDebugLazy: () => {}
        });

        state.noHealPointCount = 2;
        state.nextHealAllowedTime = 35000;
        state.pendingNoHealRecoveryCheck = false;
        state.playErrorCount = 3;
        state.nextPlayHealAllowedTime = 36000;
        state.healPointRepeatCount = 2;
        state.progressStreakMs = CONFIG.stall.PLAY_BACKOFF_CLEAR_PROGRESS_MS;
        state.lastPlayErrorTime = 20000;
        state.lastSyncWallTime = 30000;
        state.lastSyncRate = CONFIG.monitoring.SYNC_RATE_MIN + 0.1;
        state.lastSyncDriftMs = CONFIG.monitoring.SYNC_DRIFT_MAX_MS - 1;

        reset.clearBackoffOnProgress('progress', 30000);
        reset.clearPlayBackoffOnProgress('progress', 30000);

        expect(state.noHealPointCount).toBe(0);
        expect(state.nextHealAllowedTime).toBe(0);
        expect(state.playErrorCount).toBe(0);
        expect(state.nextPlayHealAllowedTime).toBe(0);
        expect(state.healPointRepeatCount).toBe(0);
    });

    it('retains no-heal backoff until a healthy post-no-heal sync sample exists', () => {
        vi.useFakeTimers();
        vi.setSystemTime(30000);

        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const reset = PlaybackProgressReset.create({
            state,
            logDebugLazy: () => {}
        });

        state.noHealPointCount = 1;
        state.nextHealAllowedTime = 34000;
        state.pendingNoHealRecoveryCheck = true;
        state.lastNoHealDecisionTime = 29000;
        state.lastSyncWallTime = 28000;
        state.lastSyncRate = CONFIG.monitoring.SYNC_RATE_MIN - 0.2;
        state.lastSyncDriftMs = CONFIG.monitoring.SYNC_DRIFT_MAX_MS + 100;
        state.degradedSyncCount = 1;

        reset.clearBackoffOnProgress('progress', 30000);

        expect(state.noHealPointCount).toBe(1);
        expect(state.nextHealAllowedTime).toBe(34000);

        state.lastSyncWallTime = 30000;
        state.lastSyncRate = CONFIG.monitoring.SYNC_RATE_MIN + 0.1;
        state.lastSyncDriftMs = CONFIG.monitoring.SYNC_DRIFT_MAX_MS - 1;
        state.degradedSyncCount = 0;

        reset.clearBackoffOnProgress('progress', 30000);

        expect(state.noHealPointCount).toBe(0);
        expect(state.nextHealAllowedTime).toBe(0);
        expect(state.pendingNoHealRecoveryCheck).toBe(false);
    });

    it('retains play backoff until resumed progress is healthy', () => {
        vi.useFakeTimers();
        vi.setSystemTime(30000);

        const video = createVideo();
        const state = PlaybackStateStore.create(video);
        const reset = PlaybackProgressReset.create({
            state,
            logDebugLazy: () => {}
        });

        state.playErrorCount = 1;
        state.nextPlayHealAllowedTime = 36000;
        state.healPointRepeatCount = 1;
        state.progressStreakMs = CONFIG.stall.PLAY_BACKOFF_CLEAR_PROGRESS_MS - 1;
        state.lastPlayErrorTime = 29000;
        state.lastSyncWallTime = 28000;
        state.lastSyncRate = CONFIG.monitoring.SYNC_RATE_MIN - 0.2;
        state.lastSyncDriftMs = CONFIG.monitoring.SYNC_DRIFT_MAX_MS + 100;
        state.degradedSyncCount = 1;

        reset.clearPlayBackoffOnProgress('progress', 30000);

        expect(state.playErrorCount).toBe(1);
        expect(state.nextPlayHealAllowedTime).toBe(36000);
        expect(state.healPointRepeatCount).toBe(1);
    });
});
