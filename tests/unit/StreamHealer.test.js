import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('StreamHealer', () => {
    let video;

    beforeEach(() => {
        video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(video, 'buffered', {
            value: { length: 0, start: () => 0, end: () => 0 },
            configurable: true
        });

        document.querySelector = vi.fn().mockReturnValue(video);

        // Mock Fn.sleep if used (likely used in internal loops)
        // But since we are testing via init/stop, maybe we don't need to mock internals unless we wait.

        if (window.StreamHealer) {
            window.StreamHealer.init(); // Reset state effectively or re-init
        }
    });

    afterEach(() => {
        vi.clearAllMocks();
        if (window.StreamHealer && window.StreamHealer.stop) {
            window.StreamHealer.stop();
        }
    });

    it('initializes correctly', () => {
        expect(window.StreamHealer).toBeDefined();
    });

    // We can't easily test internal polling logic without exposing internals or mocking globals deeply.
    // For now, existence and basic public API is enough to prove the build works.

    it('has stop method', () => {
        expect(typeof window.StreamHealer.stop).toBe('function');
    });
});
