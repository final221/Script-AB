import { Test, assert, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runRecoveryDiagnosticsTests = async () => {
    await Test.run('RecoveryDiagnostics: Detects detached video', () => {
        const detachedVideo = document.createElement('video');
        const result = RecoveryDiagnostics.diagnose(detachedVideo);

        assertEquals(result.canRecover, false, 'Should not be recoverable');
        assertEquals(result.suggestedStrategy, 'fatal', 'Should suggest fatal strategy');
        assert(result.blockers.includes('VIDEO_DETACHED'), 'Should detect VIDEO_DETACHED blocker');
    });

    await Test.run('RecoveryDiagnostics: Detects insufficient ready state', () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
        const result = RecoveryDiagnostics.diagnose(video);

        assertEquals(result.canRecover, true, 'Should be recoverable');
        assertEquals(result.suggestedStrategy, 'wait', 'Should suggest wait strategy');
        assert(result.blockers.includes('INSUFFICIENT_DATA'), 'Should detect INSUFFICIENT_DATA');
    });

    await Test.run('RecoveryDiagnostics: Healthy video state', () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        const result = RecoveryDiagnostics.diagnose(video);

        assertEquals(result.canRecover, true, 'Should be recoverable');
        assert(result.suggestedStrategy !== 'fatal', 'Should not be fatal');
    });
};
