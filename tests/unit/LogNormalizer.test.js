import { describe, it, expect } from 'vitest';

describe('LogNormalizer', () => {
    it('normalizes tagged internal logs and merges inline pairs', () => {
        const result = LogNormalizer.normalizeInternal('[STATE] Transition a=1 b=two', { video: 1 });
        expect(result.message).toBe('[STATE]');
        expect(result.detail).toMatchObject({
            message: 'Transition',
            a: '1',
            b: 'two',
            video: 1
        });
    });

    it('builds console events with channel prefix', () => {
        const event = LogNormalizer.buildConsoleEvent('log', '(playback-monitor) Play - moving');
        expect(event.type).toBe('console');
        expect(event.message).toBe('(playback-monitor)');
        expect(event.detail).toMatchObject({
            message: 'Play - moving',
            level: 'log'
        });
    });
});
