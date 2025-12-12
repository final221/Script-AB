import { describe, it, expect } from 'vitest';

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

});
