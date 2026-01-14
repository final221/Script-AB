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

describe('PlaybackStateTracker.updateProgress', () => {
    it('clears play-error backoff when progress resumes', () => {
        const video = createVideo({ currentTime: 0, paused: false, readyState: 4, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-6', logDebug);

        tracker.state.playErrorCount = 2;
        tracker.state.nextPlayHealAllowedTime = Date.now() + 10000;
        tracker.state.healPointRepeatCount = 2;
        tracker.state.lastHealPointKey = '1.00-2.00';

        defineVideoProps(video, { currentTime: 1 });
        tracker.updateProgress('timeupdate');

        expect(tracker.state.playErrorCount).toBe(0);
        expect(tracker.state.nextPlayHealAllowedTime).toBe(0);
        expect(tracker.state.healPointRepeatCount).toBe(0);
        expect(tracker.state.lastHealPointKey).toBe(null);
    });
});

describe('PlaybackStateTracker.updateBufferStarvation', () => {
    it('marks starvation after confirm window elapses', () => {
        const video = createVideo({ readyState: 4, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-7', logDebug);
        const now = Date.now();
        const lowBuffer = CONFIG.stall.BUFFER_STARVE_THRESHOLD_S - 0.1;

        tracker.updateBufferStarvation({ bufferAhead: lowBuffer, hasBuffer: true }, 'test', now);
        expect(tracker.state.bufferStarved).toBe(false);

        tracker.updateBufferStarvation(
            { bufferAhead: lowBuffer, hasBuffer: true },
            'test',
            now + CONFIG.stall.BUFFER_STARVE_CONFIRM_MS + 1
        );
        expect(tracker.state.bufferStarved).toBe(true);
        expect(tracker.state.bufferStarveUntil).toBeGreaterThan(now);
    });

    it('clears starvation when buffer recovers', () => {
        const video = createVideo({ readyState: 4, currentSrc: 'blob:stream' });
        const logDebug = vi.fn();
        const tracker = PlaybackStateTracker.create(video, 'video-8', logDebug);
        const now = Date.now();

        tracker.state.bufferStarved = true;
        tracker.state.bufferStarvedSince = now - (CONFIG.stall.BUFFER_STARVE_CONFIRM_MS + 5);
        tracker.state.bufferStarveUntil = now + 1000;

        tracker.updateBufferStarvation(
            { bufferAhead: CONFIG.stall.BUFFER_STARVE_THRESHOLD_S + 1, hasBuffer: true },
            'test',
            now + 1
        );

        expect(tracker.state.bufferStarved).toBe(false);
        expect(tracker.state.bufferStarvedSince).toBe(0);
        expect(tracker.state.bufferStarveUntil).toBe(0);
    });
});
