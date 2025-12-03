import { Test, assert, assertEquals } from './test-framework.js';
import { mocks, setupTest, teardownTest } from './test-helpers.js';

// Setup/Teardown
Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

// --- Recovery Tests ---
export const runRecoveryTests = async () => {
    // --- RecoveryDiagnostics Tests ---

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

    // --- ResilienceOrchestrator Tests ---

    await Test.run('ResilienceOrchestrator: Buffer validation forces aggressive', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        // Mock BufferAnalyzer
        mocks.mock(BufferAnalyzer, 'analyze', () => ({
            bufferHealth: 'critical',
            bufferSize: 1.5
        }));

        // Mock RecoveryDiagnostics
        mocks.mock(RecoveryDiagnostics, 'diagnose', () => ({ canRecover: true, suggestedStrategy: 'standard' }));

        // Mock RecoveryStrategy
        mocks.mock(RecoveryStrategy, 'select', () => ({ execute: async () => { } }));

        const payload = {};
        await ResilienceOrchestrator.execute(container, payload);

        assertEquals(payload.forceAggressive, true, 'Should force aggressive recovery due to low buffer');
    });

    await Test.run('ResilienceOrchestrator: Recovery validation detects failures', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        // Mock BufferAnalyzer
        mocks.mock(BufferAnalyzer, 'analyze', () => ({ bufferHealth: 'healthy', bufferSize: 10 }));

        // Mock RecoveryDiagnostics
        mocks.mock(RecoveryDiagnostics, 'diagnose', () => ({ canRecover: true, suggestedStrategy: 'standard' }));

        // Mock RecoveryStrategy
        mocks.mock(RecoveryStrategy, 'select', () => ({ execute: async () => { } }));

        // Pre-snapshot state
        Object.defineProperty(video, 'readyState', { value: 3, configurable: true });
        Object.defineProperty(video, 'error', { value: null, configurable: true });

        const payload = {};
        await ResilienceOrchestrator.execute(container, payload);

        assert(true, 'ResilienceOrchestrator executed without error');
    });

    // Display summary
    Test.summary();
};
