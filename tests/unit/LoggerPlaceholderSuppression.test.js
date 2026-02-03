import { describe, it, expect, vi, afterEach } from 'vitest';

describe('Logger placeholder suppression', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('suppresses placeholder noise and emits a summary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1);

        const Logger = window.Logger;
        const LogEvents = window.LogEvents;

        const initialLogs = Logger.getLogs().length;
        const videoId = 'video-999';
        const intervalMs = CONFIG.logging.SUPPRESSION_LOG_MS;

        Logger.add(LogEvents.tagged('VIDEO', 'Video registered'), {
            videoId,
            videoState: {
                id: 999,
                currentTime: 0,
                paused: true,
                readyState: 0,
                networkState: 0,
                buffered: 'none',
                duration: 'NaN',
                currentSrc: '',
                src: ''
            }
        });

        vi.setSystemTime(intervalMs + 2);
        Logger.add(LogEvents.tagged('MONITOR', 'PlaybackMonitor started'), { videoId });

        const newLogs = Logger.getLogs().slice(initialLogs);
        const summary = newLogs.find(entry => entry.message === '[HEALER:SUPPRESSION_SUMMARY]');

        expect(summary).toBeDefined();
        expect(summary.detail.windowMs).toBeGreaterThanOrEqual(intervalMs);
        expect(summary.detail.count).toBeGreaterThanOrEqual(2);
        expect(summary.detail.sampleVideos).toContain('999');
    });
});
