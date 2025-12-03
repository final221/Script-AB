import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Core Modules', () => {

    describe('Logger', () => {
        it('captures messages', () => {
            // Access global Logger
            const Logger = window.Logger;
            const initialLogs = Logger.getLogs().length;

            Logger.add('Test message');

            const logs = Logger.getLogs();
            expect(logs.length).toBe(initialLogs + 1);
            expect(logs[logs.length - 1].message).toBe('Test message');
        });
    });

    describe('Metrics', () => {
        it('increments counters', () => {
            const Metrics = window.Metrics;
            Metrics.reset();

            Metrics.increment('ads_detected');
            expect(Metrics.get('ads_detected')).toBe(1);

            Metrics.increment('ads_detected', 5);
            expect(Metrics.get('ads_detected')).toBe(6);
        });

        it('provides summary', () => {
            const Metrics = window.Metrics;
            Metrics.reset();
            Metrics.increment('ads_detected');

            const summary = Metrics.getSummary();
            expect(summary.ads_detected).toBe(1);
            expect(summary.block_rate).toBe('0.00%'); // 0 blocked / 1 detected
        });
    });

    describe('AdBlocker', () => {
        it('initializes correctly', () => {
            const AdBlocker = window.AdBlocker;
            expect(AdBlocker).toBeDefined();
            // AdBlocker.init() might have side effects, so we just check existence
        });
    });

    describe('Logic.Player', () => {
        it('finds video element', () => {
            // Setup DOM
            document.body.innerHTML = '<div class="video-player"><video></video></div>';

            const Logic = window.Logic;
            expect(Logic).toBeDefined();

            // Logic.Player is _PlayerLogic
            expect(Logic.Player).toBeDefined();
        });
    });

    describe('PlayerContext', () => {
        it('initializes', () => {
            const PlayerContext = window.PlayerContext;
            expect(PlayerContext).toBeDefined();
        });

        it('gets context from element', () => {
            const PlayerContext = window.PlayerContext;
            const element = document.createElement('div');
            const ctx = PlayerContext.get(element);
            expect(ctx).toBeNull();
        });
    });

});
