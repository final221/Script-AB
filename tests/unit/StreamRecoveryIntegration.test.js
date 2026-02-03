import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo } from '../helpers/video.js';

const healPoint = { start: 10, end: 20, gapSize: 5, rangeIndex: 1, isNudge: false };

const createMonitoringAndRecovery = () => {
    const monitoring = MonitoringOrchestrator.create({
        logDebug: () => {},
        isHealing: () => false,
        isFallbackSource: () => false
    });
    const recovery = RecoveryOrchestrator.create({
        monitoring,
        logWithState: () => {},
        logDebug: () => {}
    });
    return { monitoring, recovery };
};

describe('Stream recovery integration', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Metrics.reset();
        document.body.innerHTML = '';
    });

    it('heals successfully through poll and seek', async () => {
        vi.spyOn(HealPointPoller, 'create').mockReturnValue({
            pollForHealPoint: async () => ({ healPoint, aborted: false }),
            hasRecovered: () => false
        });
        vi.spyOn(BufferGapFinder, 'findHealPoint').mockReturnValue(healPoint);
        vi.spyOn(LiveEdgeSeeker, 'seekAndPlay').mockResolvedValue({ success: true });

        const { monitoring, recovery } = createMonitoringAndRecovery();

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' });
        document.body.appendChild(video);

        monitoring.monitor(video);

        const videoId = monitoring.getVideoId(video);
        monitoring.candidateSelector.setActiveId(videoId);

        const entry = monitoring.monitorsById.get(videoId);
        entry.monitor.state.lastProgressTime = Date.now();

        const outcome = await recovery.attemptHeal(video, entry.monitor.state);

        expect(outcome.status).toBe('found');
        expect(Metrics.get('heals_successful')).toBe(1);
        expect(LiveEdgeSeeker.seekAndPlay).toHaveBeenCalled();

        monitoring.stopMonitoring(video);
    });

    it('routes seek failures into play-failure handling', async () => {
        vi.spyOn(HealPointPoller, 'create').mockReturnValue({
            pollForHealPoint: async () => ({ healPoint, aborted: false }),
            hasRecovered: () => false
        });
        vi.spyOn(BufferGapFinder, 'findHealPoint').mockReturnValue(healPoint);
        vi.spyOn(LiveEdgeSeeker, 'seekAndPlay').mockResolvedValue({
            success: false,
            errorName: 'PLAY_STUCK',
            error: 'play_stuck'
        });

        const { monitoring, recovery } = createMonitoringAndRecovery();

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' });
        document.body.appendChild(video);

        monitoring.monitor(video);

        const videoId = monitoring.getVideoId(video);
        monitoring.candidateSelector.setActiveId(videoId);

        const entry = monitoring.monitorsById.get(videoId);
        entry.monitor.state.lastProgressTime = Date.now();

        const playFailureSpy = vi.spyOn(monitoring.recoveryManager, 'handlePlayFailure');
        const outcome = await recovery.attemptHeal(video, entry.monitor.state);

        expect(outcome.status).toBe('failed');
        expect(Metrics.get('heals_failed')).toBe(1);
        expect(playFailureSpy).toHaveBeenCalled();

        monitoring.stopMonitoring(video);
    });
});
