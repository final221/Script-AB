import { describe, it, expect, vi, afterEach } from 'vitest';

describe('Logger placeholder suppression', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps the first placeholder diagnostics visible before suppressing and emitting a summary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1);

        const Logger = window.Logger;
        const LogEvents = window.LogEvents;

        const initialLogs = Logger.getLogs().length;
        const videoId = 'video-999';
        const intervalMs = CONFIG.logging.SUPPRESSION_LOG_MS;

        const placeholderState = {
            id: 999,
            currentTime: 0,
            paused: true,
            readyState: 0,
            networkState: 0,
            buffered: 'none',
            duration: 'NaN',
            currentSrc: '',
            src: ''
        };

        Logger.add(LogEvents.tagged('VIDEO', 'Video registered'), {
            videoId,
            videoState: placeholderState
        });
        Logger.add(LogEvents.tagged('MONITOR', 'PlaybackMonitor started'), {
            videoId,
            videoState: placeholderState
        });
        Logger.add(LogEvents.tagged('SCAN', 'Video rescan requested'), {
            videoId,
            videoState: placeholderState
        });

        vi.setSystemTime(intervalMs + 2);
        for (let i = 0; i < 20; i += 1) {
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video to escape stale state'), {
                videoId,
                videoState: placeholderState
            });
        }

        const newLogs = Logger.getLogs().slice(initialLogs);
        const summary = newLogs.find(entry => entry.message === '[HEALER:SUPPRESSION_SUMMARY]');
        const visiblePlaceholderLogs = newLogs.filter((entry) => (
            ['[HEALER:VIDEO]', '[HEALER:MONITOR]', '[HEALER:SCAN]'].includes(entry.message)
        ));

        expect(summary).toBeDefined();
        expect(summary.detail.windowMs).toBeGreaterThanOrEqual(0);
        expect(summary.detail.count).toBeGreaterThanOrEqual(20);
        expect(summary.detail.sampleVideos).toContain('999');
        expect(visiblePlaceholderLogs.length).toBe(3);
    });
});
