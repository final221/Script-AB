import { describe, it, expect } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('NoHealPointPolicy', () => {
    it('avoids quiet mode when multiple monitors exist', () => {
        const now = 100000;
        const monitorState = {
            noHealPointCount: CONFIG.stall.NO_HEAL_POINT_QUIET_AFTER - 1,
            bufferStarved: true,
            lastProgressTime: now - CONFIG.stall.FAILOVER_AFTER_STALL_MS - 1000
        };
        const video = createVideo({
            currentTime: 9.5,
            readyState: 3,
            currentSrc: 'blob:https://www.twitch.tv/stream'
        }, [[0, 10]]);

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: monitorState } }],
            ['video-2', { video: createVideo({}, [[0, 10]]), monitor: { state: {} } }]
        ]);

        const policy = window.NoHealPointPolicy.create({ monitorsById });
        const decision = policy.decide({ video, monitorState, now }, 'no_heal_point');

        expect(decision.data.quietEligible).toBe(false);
        expect(decision.data.shouldFailover).toBe(true);
    });

    it('opens a refresh window when headroom is low and readyState is sufficient', () => {
        const now = 200000;
        const monitorState = {
            noHealPointCount: CONFIG.stall.REFRESH_AFTER_NO_HEAL_POINTS - 1
        };
        const video = createVideo({
            currentTime: 9.5,
            readyState: CONFIG.stall.NO_HEAL_POINT_REFRESH_MIN_READY_STATE,
            currentSrc: 'blob:https://www.twitch.tv/stream'
        }, [[0, 10]]);

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: monitorState } }]
        ]);

        const policy = window.NoHealPointPolicy.create({ monitorsById });
        const decision = policy.decide({ video, monitorState, now }, 'no_heal_point');

        expect(decision.data.shouldSetRefreshWindow).toBe(true);
        expect(decision.data.refreshUntil).toBeGreaterThan(now);
        expect(decision.data.refreshEligible).toBe(false);
    });

    it('triggers failover after prolonged stalls even before no-heal thresholds', () => {
        const now = 250000;
        const monitorState = {
            noHealPointCount: 0,
            lastProgressTime: now - (CONFIG.stall.FAILOVER_AFTER_STALL_MS + 1)
        };
        const video = createVideo({
            currentTime: 9.5,
            readyState: 3,
            currentSrc: 'blob:https://www.twitch.tv/stream'
        }, [[0, 10]]);

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: monitorState } }],
            ['video-2', { video: createVideo({}, [[0, 10]]), monitor: { state: {} } }]
        ]);

        const policy = window.NoHealPointPolicy.create({ monitorsById });
        const decision = policy.decide({ video, monitorState, now }, 'no_heal_point');

        expect(decision.data.shouldFailover).toBe(true);
    });

    it('requires buffer starvation for last-resort switching when configured', () => {
        const now = 300000;
        const threshold = Math.max(
            CONFIG.stall.NO_HEAL_POINT_EMERGENCY_AFTER,
            CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_AFTER
        );
        const monitorState = {
            noHealPointCount: threshold - 1,
            bufferStarved: false,
            lastEmergencySwitchAt: 0
        };
        const video = createVideo({
            currentTime: 9.5,
            readyState: 3,
            currentSrc: 'blob:https://www.twitch.tv/stream'
        }, [[0, 10]]);

        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: monitorState } }],
            ['video-2', { video: createVideo({}, [[0, 10]]), monitor: { state: {} } }]
        ]);

        const policy = window.NoHealPointPolicy.create({
            monitorsById,
            candidateSelector: { selectEmergencyCandidate: () => ({ id: 'video-2' }) }
        });
        const decision = policy.decide({ video, monitorState, now }, 'no_heal_point');

        expect(decision.data.emergencyEligible).toBe(true);
        expect(decision.data.lastResortEligible).toBe(false);
    });
});
