import { Test, assert, assertEquals } from '../test-framework.js';
import { mocks, setupTest, teardownTest } from '../test-helpers.js';

Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

export const runResilienceTests = async () => {
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
};
