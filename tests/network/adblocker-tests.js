import { Test, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runAdBlockerTests = async () => {
    await Test.run('AdBlocker: Correlation detects missed ads', async () => {
        if (AdBlocker.init) AdBlocker.init();

        const stats = AdBlocker.getCorrelationStats();
        assertEquals(typeof stats.lastAdDetectionTime, 'number', 'Should have lastAdDetectionTime');
        assertEquals(typeof stats.recoveryTriggersWithoutAds, 'number', 'Should have recoveryTriggersWithoutAds');
    });
};
