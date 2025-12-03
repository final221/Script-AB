import { Test, assert, assertEquals } from '../test-framework.js';
import { mocks, setupTest, teardownTest } from '../test-helpers.js';

// Setup/Teardown
Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

// --- Health Monitor Tests ---
export const runHealthMonitorTests = async () => {
    await Test.run('HealthMonitor: Cooldown prevents spam', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        HealthMonitor.start(container);

        // Mock StuckDetector
        mocks.mock(StuckDetector, 'check', () => ({ reason: 'test', details: {} }));

        // First trigger
        await Fn.sleep(1100);

        const triggersAfterFirst = Metrics.get('health_triggers');
        assert(triggersAfterFirst >= 1, 'Should trigger once');

        // Wait less than cooldown (5s)
        await Fn.sleep(2000);

        const triggersAfterShortWait = Metrics.get('health_triggers');
        assertEquals(triggersAfterShortWait, triggersAfterFirst, 'Should NOT trigger again during cooldown');

        HealthMonitor.stop();
    });

    await Test.run('HealthMonitor: Pause/Resume works', async () => {
        const container = document.createElement('div');
        const video = document.createElement('video');
        container.appendChild(video);
        document.body.appendChild(container);

        HealthMonitor.start(container);

        mocks.mock(StuckDetector, 'check', () => ({ reason: 'test', details: {} }));

        // Trigger once
        await Fn.sleep(1100);
        const initialTriggers = Metrics.get('health_triggers');
        assert(initialTriggers >= 1, 'Should trigger initially');

        // Pause
        HealthMonitor.pause();

        // Wait for cooldown to expire (5s) + interval
        await Fn.sleep(6000);

        const triggersWhilePaused = Metrics.get('health_triggers');
        assertEquals(triggersWhilePaused, initialTriggers, 'Should NOT trigger while paused');

        // Resume
        HealthMonitor.resume();

        HealthMonitor.stop();
    });
};
