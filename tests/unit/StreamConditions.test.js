import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo, setBufferedRanges, defineVideoProps } from '../helpers/video.js';

const advanceProgress = (video, steps = 6, stepMs = 1000) => {
    let currentTime = Number(video.currentTime) || 0;
    for (let i = 0; i < steps; i += 1) {
        vi.advanceTimersByTime(stepMs);
        currentTime += 1;
        defineVideoProps(video, { currentTime });
        video.dispatchEvent(new Event('timeupdate'));
    }
};

describe('Stream conditions', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('switches to a progressing candidate when the active one stalls', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const monitoring = MonitoringOrchestrator.create({
            logDebug: () => {},
            isHealing: () => false,
            isFallbackSource: () => false
        });

        const videoA = createVideo({ paused: false, readyState: 4, currentSrc: 'src-a' });
        const videoB = createVideo({ paused: false, readyState: 4, currentSrc: 'src-b' });

        document.body.append(videoA, videoB);

        monitoring.monitor(videoA);
        monitoring.monitor(videoB);

        const idA = monitoring.getVideoId(videoA);
        const idB = monitoring.getVideoId(videoB);

        monitoring.candidateSelector.setActiveId(idA);

        videoB.dispatchEvent(new Event('playing'));
        advanceProgress(videoB, 6, 1000);

        videoA.dispatchEvent(new Event('waiting'));

        monitoring.candidateSelector.evaluateCandidates('stall');

        expect(monitoring.candidateSelector.getActiveId()).toBe(idB);

        monitoring.stopMonitoring(videoA);
        monitoring.stopMonitoring(videoB);
    });

    it('invokes the stall handler after sustained no-progress watchdog checks', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const onStall = vi.fn();
        const monitoring = MonitoringOrchestrator.create({
            logDebug: () => {},
            isHealing: () => false,
            isFallbackSource: () => false,
            onStall
        });

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' });
        setBufferedRanges(video, []);
        document.body.appendChild(video);

        monitoring.monitor(video);

        video.dispatchEvent(new Event('playing'));
        advanceProgress(video, 3, 1000);

        vi.advanceTimersByTime(CONFIG.stall.STALL_CONFIRM_MS + CONFIG.stall.WATCHDOG_INTERVAL_MS + 500);

        expect(onStall).toHaveBeenCalled();
        const [, detail, state] = onStall.mock.calls[0];
        expect(detail.trigger).toBe('WATCHDOG');
        expect(state.state).toBe(MonitorStates.STALLED);

        monitoring.stopMonitoring(video);
    });
});
