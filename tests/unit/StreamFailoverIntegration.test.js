import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo, defineVideoProps } from '../helpers/video.js';

const advanceProgress = (video, steps = 6, stepMs = 1000) => {
    let currentTime = Number(video.currentTime) || 0;
    for (let i = 0; i < steps; i += 1) {
        vi.advanceTimersByTime(stepMs);
        currentTime += 1;
        defineVideoProps(video, { currentTime });
        video.dispatchEvent(new Event('timeupdate'));
    }
};

describe('Stream failover integration', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('fails over after repeated no-heal points and stays on a progressing candidate', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.stall.FAILOVER_COOLDOWN_MS + 1);

        const originalEmergencySwitch = CONFIG.stall.NO_HEAL_POINT_EMERGENCY_SWITCH;
        const originalLastResortSwitch = CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_SWITCH;
        const originalProbationAfter = CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS;

        CONFIG.stall.NO_HEAL_POINT_EMERGENCY_SWITCH = false;
        CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_SWITCH = false;
        CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS = Number.MAX_SAFE_INTEGER;

        const monitoring = MonitoringOrchestrator.create({
            logDebug: () => {},
            isHealing: () => false,
            isFallbackSource: () => false
        });

        try {
            const videoA = createVideo(
                { paused: false, readyState: 4, currentSrc: 'src-a' },
                [[0, 10]]
            );
            const videoB = createVideo({ paused: false, readyState: 4, currentSrc: 'src-b' });

            document.body.append(videoA, videoB);

            monitoring.monitor(videoA);
            monitoring.monitor(videoB);

            const idA = monitoring.getVideoId(videoA);
            const idB = monitoring.getVideoId(videoB);

            monitoring.candidateSelector.setActiveId(idA);

            videoB.dispatchEvent(new Event('playing'));
            advanceProgress(videoB, 6, 1000);

            const entryB = monitoring.monitorsById.get(idB);
            entryB.monitor.state.hasProgress = true;
            entryB.monitor.state.progressEligible = true;
            entryB.monitor.state.progressStreakMs = CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS + 1;
            entryB.monitor.state.lastProgressTime = Date.now();

            const entryA = monitoring.monitorsById.get(idA);
            entryA.monitor.state.noHealPointCount = CONFIG.stall.FAILOVER_AFTER_NO_HEAL_POINTS - 1;

            monitoring.recoveryManager.handleNoHealPoint(videoA, entryA.monitor.state, 'no_heal_point');

            expect(monitoring.candidateSelector.getActiveId()).toBe(idB);

            entryB.monitor.state.lastProgressTime = Date.now() + 1;

            vi.advanceTimersByTime(CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS + 1);

            expect(monitoring.candidateSelector.getActiveId()).toBe(idB);
            const logs = Logger.getLogs();
            const successLogged = logs.some(entry => entry.message === LogTags.TAG.FAILOVER_SUCCESS);
            expect(successLogged).toBe(true);

            monitoring.stopMonitoring(videoB);
        } finally {
            CONFIG.stall.NO_HEAL_POINT_EMERGENCY_SWITCH = originalEmergencySwitch;
            CONFIG.stall.NO_HEAL_POINT_LAST_RESORT_SWITCH = originalLastResortSwitch;
            CONFIG.stall.PROBATION_AFTER_NO_HEAL_POINTS = originalProbationAfter;
        }
    });
});
