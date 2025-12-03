import { Test, assert, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runPlayerContextTests = async () => {
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
};
