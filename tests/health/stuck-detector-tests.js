import { Test, assertEquals } from '../test-framework.js';
import { setupTest, teardownTest } from '../test-helpers.js';

// Setup/Teardown
Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

// --- Stuck Detector Tests ---
export const runStuckDetectorTests = async () => {
    await Test.run('StuckDetector: Ignores paused video', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        Object.defineProperty(video, 'ended', { value: false, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 10, configurable: true });

        if (typeof StuckDetector !== 'undefined') {
            StuckDetector.reset(video);
            const result = StuckDetector.check(video);
            assertEquals(result, null, 'Should not detect stuck when paused');
        } else {
            console.warn('StuckDetector not loaded - skipping');
        }
    });

    await Test.run('StuckDetector: Ignores buffering state', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'ended', { value: false, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 10, configurable: true });

        StuckDetector.reset(video);

        // Multiple checks while buffering
        for (let i = 0; i < 5; i++) {
            const result = StuckDetector.check(video);
            assertEquals(result, null, 'Should not detect stuck while buffering');
        }
    });

    await Test.run('StuckDetector: Ignores seeking state', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'seeking', { value: true, configurable: true });
        Object.defineProperty(video, 'currentTime', { value: 10, configurable: true });

        StuckDetector.reset(video);

        const result = StuckDetector.check(video);
        assertEquals(result, null, 'Should not detect stuck while seeking');
    });
};
