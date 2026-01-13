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
    it('defers hard reset until grace window expires', () => {
        const video = createVideo({ readyState: 0, networkState: 0, currentSrc: '' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-1', logDebug);
        const onReset = vi.fn();

        tracker.handleReset('emptied', onReset);

        expect(tracker.state.state).not.toBe('RESET');
        expect(tracker.state.resetPendingAt).toBeGreaterThan(0);
        expect(onReset).not.toHaveBeenCalled();

        tracker.state.resetPendingAt = Date.now() - (CONFIG.stall.RESET_GRACE_MS + 1);
        tracker.evaluateResetPending('test');

        expect(tracker.state.state).toBe('RESET');
        expect(onReset).toHaveBeenCalledOnce();
    });

    it('defers soft reset until grace window expires', () => {
        const video = createVideo({ readyState: 1, networkState: 3, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-2', logDebug);
        const onReset = vi.fn();

        tracker.handleReset('abort', onReset);

        expect(tracker.state.state).not.toBe('RESET');
        expect(tracker.state.resetPendingAt).toBeGreaterThan(0);
        expect(onReset).not.toHaveBeenCalled();

        tracker.state.resetPendingAt = Date.now() - (CONFIG.stall.RESET_GRACE_MS + 1);
        tracker.evaluateResetPending('test');

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
        expect(tracker.state.resetPendingAt).toBe(0);
        expect(onReset).not.toHaveBeenCalled();
    });

    it('clears pending reset when video recovers', () => {
        const video = createVideo({ readyState: 0, networkState: 0, currentSrc: '' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-4', logDebug);
        const onReset = vi.fn();

        tracker.handleReset('emptied', onReset);
        expect(tracker.state.resetPendingAt).toBeGreaterThan(0);

        defineVideoProps(video, { readyState: 2, networkState: 1, currentSrc: 'blob:stream' });
        tracker.evaluateResetPending('test');

        expect(tracker.state.resetPendingAt).toBe(0);
        expect(tracker.state.state).not.toBe('RESET');
        expect(onReset).not.toHaveBeenCalled();
    });
});

describe('PlaybackStateTracker.shouldSkipUntilProgress', () => {
    it('skips until initial progress grace elapses', () => {
        const video = createVideo();
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-4', logDebug);
        const graceMs = CONFIG.stall.INIT_PROGRESS_GRACE_MS || CONFIG.stall.STALL_CONFIRM_MS;

        expect(tracker.shouldSkipUntilProgress()).toBe(true);

        tracker.state.firstSeenTime = Date.now() - (graceMs + 1);
        expect(tracker.shouldSkipUntilProgress()).toBe(false);

        const messages = logDebug.mock.calls.map(call => call[0]);
        expect(messages).toContain('[HEALER:WATCHDOG] Awaiting initial progress');
        expect(messages).toContain('[HEALER:WATCHDOG] Initial progress timeout');
    });

    it('uses ready time as the baseline when available', () => {
        const video = createVideo({ readyState: 1, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-5', logDebug);
        const graceMs = CONFIG.stall.INIT_PROGRESS_GRACE_MS || CONFIG.stall.STALL_CONFIRM_MS;

        tracker.state.firstSeenTime = Date.now();
        tracker.state.firstReadyTime = Date.now() - (graceMs + 1);

        expect(tracker.shouldSkipUntilProgress()).toBe(false);
    });
});
