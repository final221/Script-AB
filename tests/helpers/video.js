import { vi } from 'vitest';

const defineVideoProps = (video, props) => {
    Object.entries(props).forEach(([key, value]) => {
        Object.defineProperty(video, key, { value, configurable: true });
    });
};

const createTimeRanges = (ranges = []) => ({
    length: ranges.length,
    start: (i) => ranges[i]?.[0] ?? 0,
    end: (i) => ranges[i]?.[1] ?? 0
});

const setBufferedRanges = (video, ranges = []) => {
    Object.defineProperty(video, 'buffered', {
        value: createTimeRanges(ranges),
        configurable: true
    });
};

const createVideo = (overrides = {}, ranges = []) => {
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
    setBufferedRanges(video, ranges);
    return video;
};

export {
    createTimeRanges,
    setBufferedRanges,
    defineVideoProps,
    createVideo
};
