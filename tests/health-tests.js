import { Test, assert, assertEquals } from './test-framework.js';
import { mocks, setupTest, teardownTest } from './test-helpers.js';

// Setup/Teardown
Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

// --- Health Monitoring Tests ---
(async () => {
    // --- Stuck Detector Tests ---

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
        Object.defineProperty(video, 'readyState', { value: 2, configurable: true }); // HAVE_CURRENT_DATA (Buffering)
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

    // --- Health Monitor Tests ---

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

    // --- Frame Drop Detector Tests ---

    await Test.run('FrameDropDetector: Ignores drops during normal playback', async () => {
        const video = document.createElement('video');

        // Mock: Video is playing with some frame drops (normal)
        Object.defineProperty(video, 'currentTime', {
            value: 10,
            configurable: true,
            writable: true
        });
        video.getVideoPlaybackQuality = () => ({
            droppedVideoFrames: 100,
            totalVideoFrames: 300
        });

        FrameDropDetector.reset();

        // First check - initializes state
        FrameDropDetector.check(video);

        // Simulate time passing and playback advancing
        await Fn.sleep(100);

        // Update mock to show advancement + more drops
        Object.defineProperty(video, 'currentTime', {
            value: 10.1, // Advanced 0.1s
            configurable: true,
            writable: true
        });
        video.getVideoPlaybackQuality = () => ({
            droppedVideoFrames: 650, // Massive drop (would trigger severe)
            totalVideoFrames: 330
        });

        // Override Date.now
        const realDateNow = Date.now;
        mocks.mock(Date, 'now', () => realDateNow() + 100);

        const result = FrameDropDetector.check(video);
        assertEquals(result, null, 'Should not trigger when video is progressing');
    });
})();
