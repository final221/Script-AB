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

describe('Stream integration', () => {
    const configBackup = {
        autoRefresh: CONFIG.stall.AUTO_PAGE_REFRESH,
        refreshDelay: CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS
    };

    afterEach(() => {
        CONFIG.stall.AUTO_PAGE_REFRESH = configBackup.autoRefresh;
        CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS = configBackup.refreshDelay;
        try {
            sessionStorage.removeItem('twad_auto_refresh_at');
        } catch {
            // ignore storage errors in test env
        }
        Metrics.reset();
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('refreshes a missing-source video through the stall pipeline', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.stall.REFRESH_COOLDOWN_MS + 1);
        CONFIG.stall.AUTO_PAGE_REFRESH = false;

        const { monitoring, recovery } = createMonitoringAndRecovery();

        const video = createVideo({
            paused: true,
            readyState: 0,
            networkState: 0,
            currentSrc: '',
            src: ''
        });
        setBufferedRanges(video, []);
        document.body.appendChild(video);

        monitoring.monitor(video);

        const videoId = monitoring.getVideoId(video);
        const entry = monitoring.monitorsById.get(videoId);

        recovery.onStallDetected(video, {
            trigger: 'WATCHDOG',
            stalledFor: '6000ms',
            bufferExhausted: true,
            paused: true
        }, entry.monitor.state);

        expect(monitoring.getMonitoredCount()).toBe(0);

        vi.runOnlyPendingTimers();

        expect(monitoring.getMonitoredCount()).toBe(1);
    });

    it('schedules auto refresh when allowed without stopping monitors', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.stall.REFRESH_COOLDOWN_MS + 1);
        CONFIG.stall.AUTO_PAGE_REFRESH = true;
        CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS = 50;
        const initialLogs = Logger.getLogs().length;

        const { monitoring, recovery } = createMonitoringAndRecovery();

        const video = createVideo({
            paused: false,
            readyState: 4,
            networkState: 2,
            currentSrc: 'src-main',
            src: 'src-main'
        });
        document.body.appendChild(video);

        monitoring.monitor(video);

        recovery.handleExternalSignal({
            type: 'decoder_error',
            level: 'error',
            message: 'Decoder failed'
        });

        expect(monitoring.getMonitoredCount()).toBe(1);

        const newLogs = Logger.getLogs().slice(initialLogs);
        const refreshLog = newLogs.find(entry => entry.detail?.message === 'Auto page refresh scheduled');
        expect(refreshLog).toBeDefined();

    });

    it('selects a new active video when the active one is removed', () => {
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

        document.body.removeChild(videoA);
        vi.advanceTimersByTime(CONFIG.stall.WATCHDOG_INTERVAL_MS + 10);

        expect(monitoring.candidateSelector.getActiveId()).toBe(idB);

        monitoring.stopMonitoring(videoB);
    });

    it('routes console stall signals into recovery handling', () => {
        vi.useFakeTimers();
        vi.setSystemTime(10000);
        Metrics.reset();

        const { monitoring, recovery } = createMonitoringAndRecovery();

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' });
        document.body.appendChild(video);

        monitoring.monitor(video);
        const videoId = monitoring.getVideoId(video);
        monitoring.candidateSelector.setActiveId(videoId);

        const entry = monitoring.monitorsById.get(videoId);
        entry.monitor.state.hasProgress = true;
        entry.monitor.state.lastProgressTime = Date.now() - (CONFIG.stall.STALL_CONFIRM_MS + 10);

        defineVideoProps(video, { currentTime: 10 });

        recovery.handleExternalSignal({
            type: 'playhead_stall',
            message: 'Playhead stalled',
            level: 'warn',
            playheadSeconds: 10,
            bufferEndSeconds: 12
        });

        expect(Metrics.get('stalls_detected')).toBe(1);

        monitoring.stopMonitoring(video);
    });
});
