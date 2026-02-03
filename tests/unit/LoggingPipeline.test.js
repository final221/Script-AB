import { describe, it, expect } from 'vitest';

describe('Logging pipeline', () => {
    it('formats merged logs without loss or crash', () => {
        const initialLogs = Logger.getLogs().length;
        const initialConsole = Logger.getConsoleLogs().length;

        Logger.add(LogEvents.tagged('STATE', 'Transition'), {
            videoId: 'video-1',
            from: 'STALLED',
            to: 'PLAYING',
            currentTime: 1.234
        });
        Logger.add('[STATE] Inline a=1 b=two', { video: 1 });
        Logger.captureConsole('warn', ['(playback-monitor) Warning here']);

        const newLogs = Logger.getLogs().slice(initialLogs);
        const newConsole = Logger.getConsoleLogs().slice(initialConsole);
        const merged = Logger.getMergedTimeline().slice(-(newLogs.length + newConsole.length));

        expect(merged.length).toBeGreaterThanOrEqual(3);

        const rendered = TimelineRenderer.render(merged);
        expect(rendered).toContain('[TIMELINE - Merged script + console logs]');
        expect(rendered).toContain('[STATE]');
        expect(rendered).toContain('(playback-monitor)');
    });
});
