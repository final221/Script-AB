import { Test, assert, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runLoggerTests = async () => {
    await Test.run('Logger: Captures messages', () => {
        const testMsg = `[TEST] Test message ${Date.now()}`;
        Logger.add(testMsg, { data: 'test' });

        const logs = Logger.getLogs();
        assert(logs.length > 0, 'Logger should capture messages');
        assert(logs.some(l => l.message && l.message.includes(testMsg)), 'Logger should contain test message');
    });

    await Test.run('Integration: Logger and Metrics work together', () => {
        const testMsg = `[INTEGRATION] Test log ${Date.now()}`;
        Logger.add(testMsg);
        Metrics.increment('errors');

        const logs = Logger.getLogs();
        assert(logs.some(l => l.message && l.message.includes(testMsg)), 'Logger should have messages');
        assertEquals(Metrics.get('errors'), 1, 'Metrics should be incremented');
    });
};
