import { Test, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runMetricsTests = async () => {
    await Test.run('Metrics: Increments counters', () => {
        Metrics.increment('errors');
        Metrics.increment('errors');

        assertEquals(Metrics.get('errors'), 2, 'Counter should be 2');
    });

    await Test.run('Metrics: Returns 0 for unknown keys', () => {
        assertEquals(Metrics.get('unknown_key'), 0, 'Unknown key should return 0');
    });
};
