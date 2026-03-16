import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MonitorRegistry candidate interval', () => {
    let originalCreate;

    beforeEach(() => {
        originalCreate = window.PlaybackMonitor.create;
        window.PlaybackMonitor.create = () => ({
            start: vi.fn(),
            stop: vi.fn(),
            state: {}
        });
    });

    afterEach(() => {
        window.PlaybackMonitor.create = originalCreate;
        vi.useRealTimers();
    });

    it('skips interval candidate evaluation when another evaluation ran recently', () => {
        vi.useFakeTimers();
        const registry = window.MonitorRegistry.create({
            logDebug: () => {},
            isHealing: () => false,
            onStall: () => {}
        });
        const candidateSelector = {
            getActiveId: () => null,
            setActiveId: vi.fn(),
            evaluateCandidates: vi.fn(),
            pruneMonitors: vi.fn(),
            shouldRunIntervalEvaluation: vi.fn(() => false)
        };
        registry.bind({
            candidateSelector,
            recoveryManager: { onMonitorRemoved: vi.fn() }
        });

        registry.monitor(document.createElement('video'));
        expect(candidateSelector.evaluateCandidates).toHaveBeenCalledWith('register');

        candidateSelector.evaluateCandidates.mockClear();
        vi.advanceTimersByTime(CONFIG.stall.WATCHDOG_INTERVAL_MS + 1);

        expect(candidateSelector.shouldRunIntervalEvaluation).toHaveBeenCalled();
        expect(candidateSelector.evaluateCandidates).not.toHaveBeenCalled();
    });
});
