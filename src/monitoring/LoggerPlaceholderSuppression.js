// --- LoggerPlaceholderSuppression ---
// @module LoggerPlaceholderSuppression
/**
 * Suppresses repetitive placeholder/no-source log churn and emits periodic summaries.
 */
const LoggerPlaceholderSuppression = (() => {
    const PLACEHOLDER_SUPPRESSION_THRESHOLD = 20;
    const PLACEHOLDER_SAMPLE_MAX = 5;
    const PLACEHOLDER_SUPPRESS_TAGS = new Set([
        'VIDEO',
        'MONITOR',
        'SCAN',
        'SCAN_ITEM',
        'STALL',
        'STATE',
        'WATCHDOG',
        'REFRESH',
        'STOP'
    ]);

    const normalizeVideoId = (value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value !== 'string') return null;
        const match = value.match(/^video-(\d+)$/);
        return match ? match[1] : value;
    };

    const normalizeElementId = (value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'string' && value.length) return value;
        return null;
    };

    const extractVideoId = (detail) => normalizeVideoId(detail?.videoId ?? detail?.video ?? detail?.videoState?.id);
    const extractElementId = (detail) => normalizeElementId(detail?.elementId ?? detail?.videoState?.elementId);

    const extractStateSnapshot = (detail) => {
        if (!detail || typeof detail !== 'object') return null;
        if (detail.videoState && typeof detail.videoState === 'object') return detail.videoState;
        const keys = ['readyState', 'networkState', 'currentSrc', 'src', 'buffered', 'currentTime', 'paused', 'duration'];
        return keys.some(key => Object.prototype.hasOwnProperty.call(detail, key)) ? detail : null;
    };

    const isPlaceholderState = (state) => {
        if (!state || typeof state !== 'object') return false;
        const hasSrc = Boolean(state.currentSrc || state.src);
        const readyState = Number(state.readyState);
        const networkState = Number(state.networkState);
        if (hasSrc) return false;
        if (!Number.isFinite(readyState) || !Number.isFinite(networkState)) return false;
        return readyState === 0 && networkState === 0;
    };

    const getTagKey = (message) => {
        if (typeof LogSanitizer === 'undefined' || !LogSanitizer?.getRawTag) return null;
        const raw = LogSanitizer.getRawTag(message);
        if (!raw) return null;
        return raw.startsWith('HEALER:') ? raw.slice(7) : raw;
    };

    const buildSummary = (windowMs, sampleIds, sampleElements, count) => {
        const summaryTag = (typeof LogTags !== 'undefined' && LogTags?.TAG?.SUPPRESSION)
            ? LogTags.TAG.SUPPRESSION
            : '[HEALER:SUPPRESSION_SUMMARY]';
        return {
            message: summaryTag,
            detail: {
                message: 'Suppressed placeholder refresh cycles',
                reason: 'no_source',
                count,
                sampleVideos: Array.from(sampleIds || []),
                sampleElements: Array.from(sampleElements || []),
                windowMs
            }
        };
    };

    const create = () => {
        const placeholderVideos = new Map();
        const suppression = {
            count: 0,
            windowStartAt: 0,
            sampleIds: new Set(),
            sampleElements: new Set()
        };

        const evaluate = (message, detail) => {
            const videoId = extractVideoId(detail);
            const elementId = extractElementId(detail);
            const state = extractStateSnapshot(detail);
            const now = Date.now();

            if (videoId && state) {
                if (isPlaceholderState(state)) {
                    placeholderVideos.set(videoId, { lastSeenAt: now, elementId });
                } else {
                    placeholderVideos.delete(videoId);
                }
            }

            if (!videoId || !placeholderVideos.has(videoId)) {
                return { suppress: false };
            }

            const tagKey = getTagKey(message);
            if (!tagKey || !PLACEHOLDER_SUPPRESS_TAGS.has(tagKey)) {
                return { suppress: false };
            }

            if (!suppression.windowStartAt) {
                suppression.windowStartAt = now;
            }
            suppression.count += 1;
            if (suppression.sampleIds.size < PLACEHOLDER_SAMPLE_MAX) {
                suppression.sampleIds.add(videoId);
            }
            if (elementId && suppression.sampleElements.size < PLACEHOLDER_SAMPLE_MAX) {
                suppression.sampleElements.add(elementId);
            }

            const windowMs = now - suppression.windowStartAt;
            const intervalMs = CONFIG?.logging?.SUPPRESSION_LOG_MS || 300000;
            if (suppression.count >= PLACEHOLDER_SUPPRESSION_THRESHOLD || windowMs >= intervalMs) {
                const emit = buildSummary(
                    windowMs,
                    suppression.sampleIds,
                    suppression.sampleElements,
                    suppression.count
                );
                suppression.count = 0;
                suppression.windowStartAt = 0;
                suppression.sampleIds.clear();
                suppression.sampleElements.clear();
                return { suppress: true, emit };
            }

            return { suppress: true };
        };

        return { evaluate };
    };

    return { create };
})();
