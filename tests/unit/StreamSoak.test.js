import { describe, it, expect } from 'vitest';

describe('Stream soak', () => {
    it('caps internal logs at MAX_LOGS', () => {
        const maxLogs = CONFIG.logging.MAX_LOGS;
        for (let i = 0; i < maxLogs + 10; i += 1) {
            Logger.add('[TEST] Log overflow', { index: i });
        }
        expect(Logger.getLogs().length).toBeLessThanOrEqual(maxLogs);
    });

    it('caps console logs at MAX_CONSOLE_LOGS', () => {
        const maxLogs = CONFIG.logging.MAX_CONSOLE_LOGS;
        for (let i = 0; i < maxLogs + 10; i += 1) {
            Logger.captureConsole('log', [`console-${i}`]);
        }
        expect(Logger.getConsoleLogs().length).toBeLessThanOrEqual(maxLogs);
    });
});
