import { Test, assertEquals } from '../test-framework.js';
import { mocks, setupTest, teardownTest } from '../test-helpers.js';

// Setup/Teardown
Test.beforeEach(setupTest);
Test.afterEach(teardownTest);

// --- Frame Drop Detector Tests ---
export const runFrameDropTests = async () => {
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
};
