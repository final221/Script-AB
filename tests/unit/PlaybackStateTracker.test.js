import { describe, it, expect, vi } from 'vitest';

const defineVideoProps = (video, props) => {
    Object.entries(props).forEach(([key, value]) => {
        Object.defineProperty(video, key, { value, configurable: true });
    });
};

const createVideo = (overrides = {}) => {
    const video = document.createElement('video');
    defineVideoProps(video, {
        currentTime: 0,
        duration: 0,
        paused: false,
        readyState: 0,
        networkState: 0,
        currentSrc: '',
        ...overrides
    });
    video.getAttribute = vi.fn().mockImplementation((attr) => (attr === 'src' ? (overrides.src || '') : ''));
    Object.defineProperty(video, 'buffered', {
        value: { length: 0, start: () => 0, end: () => 0 },
        configurable: true
    });
    return video;
};

describe('PlaybackStateTracker.handleReset', () => {
    it('marks RESET on hard reset (empty src + low readyState)', () => {
        const video = createVideo({ readyState: 0, networkState: 0, currentSrc: '' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-1', logDebug);
        const onReset = vi.fn();

        tracker.handleReset('emptied', onReset);

        expect(tracker.state.state).toBe('RESET');
        expect(onReset).toHaveBeenCalledOnce();
    });

    it('marks RESET on soft reset (no buffer + low readyState + no source network)', () => {
        const video = createVideo({ readyState: 1, networkState: 3, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-2', logDebug);
        const onReset = vi.fn();

        tracker.handleReset('abort', onReset);

        expect(tracker.state.state).toBe('RESET');
        expect(onReset).toHaveBeenCalledOnce();
    });

    it('does not reset when readyState is healthy', () => {
        const video = createVideo({ readyState: 2, networkState: 1, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-3', logDebug);
        const onReset = vi.fn();

        tracker.handleReset('emptied', onReset);

        expect(tracker.state.state).not.toBe('RESET');
        expect(onReset).not.toHaveBeenCalled();
    });
});
