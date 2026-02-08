import { describe, it, expect } from 'vitest';

describe('LogFormatter', () => {
    it('aligns the first detail separator for short and long tags', () => {
        const formatter = LogFormatter.create();
        const logs = [
            {
                timestamp: '2026-02-08T12:00:00.000Z',
                type: 'internal',
                message: '[HEALER:BACKOFF]',
                detail: {
                    message: 'No heal point',
                    videoId: 'video-1',
                    noHealPointCount: 1
                }
            },
            {
                timestamp: '2026-02-08T12:00:00.100Z',
                type: 'internal',
                message: '[INSTRUMENT:RESOURCE_WINDOW_SCHEDULED]',
                detail: {
                    videoId: 'video-1',
                    reason: 'WATCHDOG'
                }
            },
            {
                timestamp: '2026-02-08T12:00:00.200Z',
                type: 'internal',
                message: '[HEALER:STARVE]',
                detail: {
                    message: 'Buffer starvation persists',
                    videoId: 'video-1'
                }
            }
        ];

        const rendered = formatter.formatLogs(logs);
        const lines = rendered.split('\n');
        const firstSeparatorColumns = lines.map((line) => line.indexOf('|'));

        expect(firstSeparatorColumns.every((value) => value > 0)).toBe(true);
        expect(new Set(firstSeparatorColumns).size).toBe(1);
    });
});
