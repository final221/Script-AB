import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Utils Modules', () => {

    describe('Logic', () => {
        it('session tracking detects key changes', () => {
            const Logic = window.Logic;
            Logic.Player.startSession();

            // First detection
            const obj1 = { ref: (x) => { } };
            Logic.Player.signatures[0].check(obj1, 'ref');

            const status1 = Logic.Player.getSessionStatus();
            expect(status1.currentKeys.k0).toBe('ref');
            expect(status1.totalChanges).toBe(0);

            // Key change during session
            const obj2 = { foo: (x) => { } };
            Logic.Player.signatures[0].check(obj2, 'foo');

            const status2 = Logic.Player.getSessionStatus();
            expect(status2.currentKeys.k0).toBe('foo');
            expect(status2.totalChanges).toBe(1);
            expect(status2.recentChanges[0].oldKey).toBe('ref');
            expect(status2.recentChanges[0].newKey).toBe('foo');

            Logic.Player.endSession();
        });

        it('instability detection works', () => {
            const Logic = window.Logic;
            Logic.Player.startSession();

            // Simulate 4 changes in quick succession
            const keys = ['ref', 'foo', 'bar', 'baz', 'qux'];
            keys.forEach(key => {
                const obj = { [key]: (x) => { } };
                Logic.Player.signatures[0].check(obj, key);
            });

            const isUnstable = Logic.Player.isSessionUnstable();
            expect(isUnstable).toBe(true);

            Logic.Player.endSession();
        });
    });

});
