import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Recovery System', () => {

    // Helper to mock global objects
    const mockGlobal = (name, implementation) => {
        const original = window[name];
        window[name] = implementation;
        return () => { window[name] = original; };
    };

    describe('RecoveryDiagnostics', () => {
        it('detects detached video', () => {
            const RecoveryDiagnostics = window.RecoveryDiagnostics;
            const detachedVideo = document.createElement('video');
            const result = RecoveryDiagnostics.diagnose(detachedVideo);

            expect(result.canRecover).toBe(false);
            expect(result.suggestedStrategy).toBe('fatal');
            expect(result.blockers).toContain('VIDEO_DETACHED');
        });

        it('detects insufficient ready state', () => {
            const RecoveryDiagnostics = window.RecoveryDiagnostics;
            const container = document.createElement('div');
            const video = document.createElement('video');
            container.appendChild(video);
            document.body.appendChild(container);

            Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
            const result = RecoveryDiagnostics.diagnose(video);

            expect(result.canRecover).toBe(true);
            expect(result.suggestedStrategy).toBe('wait');
            expect(result.blockers).toContain('INSUFFICIENT_DATA');
        });

        it('identifies healthy video state', () => {
            const RecoveryDiagnostics = window.RecoveryDiagnostics;
            const container = document.createElement('div');
            const video = document.createElement('video');
            container.appendChild(video);
            document.body.appendChild(container);

            Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
            const result = RecoveryDiagnostics.diagnose(video);

            expect(result.canRecover).toBe(true);
            expect(result.suggestedStrategy).not.toBe('fatal');
        });
    });

    describe('ResilienceOrchestrator', () => {
        let restoreMocks = [];

        afterEach(() => {
            restoreMocks.forEach(restore => restore());
            restoreMocks = [];
        });

        it('does NOT force aggressive recovery (disabled in v4.0)', async () => {
            const ResilienceOrchestrator = window.ResilienceOrchestrator;
            const container = document.createElement('div');
            const video = document.createElement('video');
            container.appendChild(video);
            document.body.appendChild(container);

            // Mock Dependencies
            restoreMocks.push(mockGlobal('BufferAnalyzer', {
                analyze: () => ({ bufferHealth: 'critical', bufferSize: 1.5, needsAggressive: true })
            }));

            restoreMocks.push(mockGlobal('RecoveryDiagnostics', {
                diagnose: () => ({ canRecover: true, suggestedStrategy: 'standard' })
            }));

            restoreMocks.push(mockGlobal('RecoveryStrategy', {
                select: () => ({ execute: async () => { }, name: 'StandardRecovery' }),
                getEscalation: () => null  // v4.0: No escalation
            }));

            // Mock other dependencies used by ResilienceOrchestrator
            restoreMocks.push(mockGlobal('RecoveryLock', {
                acquire: () => true,
                release: () => { }
            }));

            restoreMocks.push(mockGlobal('Adapters', {
                DOM: { find: () => video },
                EventBus: { emit: () => { } }
            }));

            restoreMocks.push(mockGlobal('AVSyncRouter', {
                shouldRouteToAVSync: () => false
            }));

            restoreMocks.push(mockGlobal('VideoSnapshotHelper', {
                captureVideoSnapshot: () => ({}),
                calculateRecoveryDelta: () => ({}),
            }));

            restoreMocks.push(mockGlobal('RecoveryValidator', {
                detectAlreadyHealthy: () => false,
                validateRecoverySuccess: () => ({ isValid: true, issues: [], hasImprovement: true })
            }));

            restoreMocks.push(mockGlobal('PlayRetryHandler', {
                retry: async () => true
            }));


            const payload = {};
            await ResilienceOrchestrator.execute(container, payload);

            // v4.0: Aggressive recovery is DISABLED, payload should NOT have forceAggressive
            expect(payload.forceAggressive).toBeUndefined();
        });

        it('detects recovery failures', async () => {
            const ResilienceOrchestrator = window.ResilienceOrchestrator;
            const container = document.createElement('div');
            const video = document.createElement('video');
            container.appendChild(video);
            document.body.appendChild(container);

            // Mock Dependencies
            restoreMocks.push(mockGlobal('BufferAnalyzer', {
                analyze: () => ({ bufferHealth: 'healthy', bufferSize: 10 })
            }));

            restoreMocks.push(mockGlobal('RecoveryDiagnostics', {
                diagnose: () => ({ canRecover: true, suggestedStrategy: 'standard' })
            }));

            restoreMocks.push(mockGlobal('RecoveryStrategy', {
                select: () => ({ execute: async () => { }, name: 'mock-strategy' })
            }));
            restoreMocks.push(mockGlobal('RecoveryLock', {
                acquire: () => true,
                release: () => { }
            }));
            restoreMocks.push(mockGlobal('Adapters', {
                DOM: { find: () => video }
            }));
            restoreMocks.push(mockGlobal('AVSyncRouter', {
                shouldRouteToAVSync: () => false
            }));
            restoreMocks.push(mockGlobal('VideoSnapshotHelper', {
                captureVideoSnapshot: () => ({}),
                calculateRecoveryDelta: () => ({}),
            }));
            restoreMocks.push(mockGlobal('RecoveryValidator', {
                detectAlreadyHealthy: () => false,
                validateRecoverySuccess: () => ({ isValid: false, issues: ['Failed'], hasImprovement: false })
            }));
            restoreMocks.push(mockGlobal('PlayRetryHandler', {
                retry: async () => true
            }));

            const payload = {};
            const result = await ResilienceOrchestrator.execute(container, payload);

            expect(result).toBe(false);
        });
    });
});
