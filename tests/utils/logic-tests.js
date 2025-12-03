import { Test, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runLogicTests = async () => {
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
};
