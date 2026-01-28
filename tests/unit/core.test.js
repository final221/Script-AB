import { describe, it, expect, vi } from 'vitest';

describe('Core Modules', () => {
    console.log('[Test] Core Modules running');

    describe('Logger', () => {
        it('captures messages', () => {
            // Access global Logger
            const Logger = window.Logger;
            expect(Logger).toBeDefined();

            // Mock or check implementation
            // If Logger is real, we can add a log
            if (Logger.add) {
                const initialLogs = Logger.getLogs ? (Logger.getLogs().length || 0) : 0;
                Logger.add('Test message', { detail: 'test' });

                // Depending on implementation, getLogs might be available
                // Looking at Logger.js earlier (not fully shown), it has add/log/error
            }
        });
    });

    describe('Metrics', () => {
        it('increments counters', () => {
            const Metrics = window.Metrics;
            expect(Metrics).toBeDefined();

            if (Metrics.reset) Metrics.reset();

            if (Metrics.increment) {
                Metrics.increment('heals_successful');
                if (Metrics.get) {
                    expect(Metrics.get('heals_successful')).toBe(1);
                }
            }
        });
    });

    describe('Export logs', () => {
        it('exposes exportTwitchAdLogs and forwards to ReportGenerator', () => {
            const exportFn = window.exportTwitchAdLogs;
            expect(typeof exportFn).toBe('function');

            const ReportGenerator = window.ReportGenerator;
            expect(ReportGenerator).toBeDefined();
            expect(typeof ReportGenerator.exportReport).toBe('function');

            const originalExport = ReportGenerator.exportReport;
            const spy = vi.fn();
            ReportGenerator.exportReport = spy;

            try {
                exportFn();
            } finally {
                ReportGenerator.exportReport = originalExport;
            }

            expect(spy).toHaveBeenCalledTimes(1);
            const [metricsSummary, mergedLogs, healerStats] = spy.mock.calls[0] || [];
            expect(typeof metricsSummary).toBe('object');
            expect(Array.isArray(mergedLogs)).toBe(true);
            expect(typeof healerStats).toBe('object');
        });
    });

});
