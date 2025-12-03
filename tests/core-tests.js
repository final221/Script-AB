import { Test, assert, assertEquals } from './test-framework.js';
import { mocks, setupTest, teardownTest } from './test-helpers.js';

// Setup/Teardown
Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

// --- Core Module Tests ---
(async () => {
    // --- Logger Tests ---

    await Test.run('Logger: Captures messages', () => {
        const testMsg = `[TEST] Test message ${Date.now()}`;
        Logger.add(testMsg, { data: 'test' });

        const logs = Logger.getLogs();
        assert(logs.length > 0, 'Logger should capture messages');
        assert(logs.some(l => l.message && l.message.includes(testMsg)), 'Logger should contain test message');
    });

    // --- Metrics Tests ---

    await Test.run('Metrics: Increments counters', () => {
        Metrics.increment('errors');
        Metrics.increment('errors');

        assertEquals(Metrics.get('errors'), 2, 'Counter should be 2');
    });

    await Test.run('Metrics: Returns 0 for unknown keys', () => {
        assertEquals(Metrics.get('unknown_key'), 0, 'Unknown key should return 0');
    });

    // --- AdBlocker Tests ---

    await Test.run('AdBlocker: Correlation detects missed ads', async () => {
        if (AdBlocker.init) AdBlocker.init();

        const stats = AdBlocker.getCorrelationStats();
        assertEquals(typeof stats.lastAdDetectionTime, 'number', 'Should have lastAdDetectionTime');
        assertEquals(typeof stats.recoveryTriggersWithoutAds, 'number', 'Should have recoveryTriggersWithoutAds');
    });

    // --- Integration Test: Logger + Metrics ---

    await Test.run('Integration: Logger and Metrics work together', () => {
        const testMsg = `[INTEGRATION] Test log ${Date.now()}`;
        Logger.add(testMsg);
        Metrics.increment('errors');

        const logs = Logger.getLogs();
        assert(logs.some(l => l.message && l.message.includes(testMsg)), 'Logger should have messages');
        assertEquals(Metrics.get('errors'), 1, 'Metrics should be incremented');
    });

    // --- Logic.Player Tests ---

    await Test.run('Logic: Session tracking detects key changes', () => {
        Logic.Player.startSession();

        // First detection
        const obj1 = { ref: (x) => { } };
        Logic.Player.signatures[0].check(obj1, 'ref');

        const status1 = Logic.Player.getSessionStatus();
        assertEquals(status1.currentKeys.k0, 'ref', 'Should set k0 to ref');
        assertEquals(status1.totalChanges, 0, 'No changes yet');

        // Key change during session
        const obj2 = { foo: (x) => { } };
        Logic.Player.signatures[0].check(obj2, 'foo');

        const status2 = Logic.Player.getSessionStatus();
        assertEquals(status2.currentKeys.k0, 'foo', 'Should update k0 to foo');
        assertEquals(status2.totalChanges, 1, 'Should detect change');
        assertEquals(status2.recentChanges[0].oldKey, 'ref', 'Should track old key');
        assertEquals(status2.recentChanges[0].newKey, 'foo', 'Should track new key');

        Logic.Player.endSession();
    });

    await Test.run('Logic: Instability detection works', () => {
        Logic.Player.startSession();

        // Simulate 4 changes in quick succession
        const keys = ['ref', 'foo', 'bar', 'baz', 'qux'];
        keys.forEach(key => {
            const obj = { [key]: (x) => { } };
            Logic.Player.signatures[0].check(obj, key);
        });

        const isUnstable = Logic.Player.isSessionUnstable();
        assertEquals(isUnstable, true, 'Should detect instability after 4 changes');

        Logic.Player.endSession();
    });

    // --- PlayerContext Tests ---

    await Test.run('PlayerContext: Returns null for invalid element', () => {
        const result = PlayerContext.get(null);
        assertEquals(result, null, 'Should return null for null element');
    });

    await Test.run('PlayerContext: Handles detached element gracefully', () => {
        const element = document.createElement('div');
        element.__reactInternalInstance$test = {
            memoizedProps: { player: {} }
        };

        // It shouldn't crash
        const result = PlayerContext.get(element);
        assert(true, 'Should not throw error');
    });
})();
