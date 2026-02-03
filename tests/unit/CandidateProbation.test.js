import { describe, it, expect, vi, afterEach } from 'vitest';

describe('CandidateProbation', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('logs probation start with configured window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);

        const addSpy = vi.spyOn(Logger, 'add');
        const probation = CandidateProbation.create();

        probation.activate('no_buffer');

        expect(addSpy).toHaveBeenCalledTimes(1);
        const [event, detail] = addSpy.mock.calls[0];
        expect(event.message).toBe(LogTags.TAG.PROBATION);
        expect(detail).toEqual(expect.objectContaining({
            reason: 'no_buffer',
            windowMs: CONFIG.monitoring.PROBATION_WINDOW_MS
        }));
    });

    it('ends probation after the window and logs once', () => {
        vi.useFakeTimers();
        vi.setSystemTime(2000);

        const addSpy = vi.spyOn(Logger, 'add');
        const probation = CandidateProbation.create();

        probation.activate('play_error');
        expect(probation.isActive()).toBe(true);

        vi.setSystemTime(2000 + CONFIG.monitoring.PROBATION_WINDOW_MS + 1);
        expect(probation.isActive()).toBe(false);
        expect(probation.isActive()).toBe(false);

        const probationLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.PROBATION
        );
        const endLogs = probationLogs.filter(
            (call) => call[1]?.reason === 'play_error'
                && call[1]?.windowMs === undefined
        );
        expect(endLogs.length).toBe(1);
    });
});
