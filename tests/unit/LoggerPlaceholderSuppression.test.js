import { describe, it, expect } from 'vitest';

describe('Logger placeholder suppression', () => {
    it('suppresses placeholder noise and emits a summary', () => {
        const Logger = window.Logger;
        const LogEvents = window.LogEvents;

        const initialLogs = Logger.getLogs().length;
        const videoId = 'video-999';

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

        for (let i = 0; i < 19; i += 1) {
            Logger.add(LogEvents.tagged('MONITOR', 'PlaybackMonitor started'), { videoId });
        }

        const newLogs = Logger.getLogs().slice(initialLogs);
        const summary = newLogs.find(entry => entry.message === '[HEALER:SUPPRESSION_SUMMARY]');

        expect(summary).toBeDefined();
        expect(summary.detail.count).toBeGreaterThanOrEqual(20);
        expect(summary.detail.sampleVideos).toContain('999');
    });
});
