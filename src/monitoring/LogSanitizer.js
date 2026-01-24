// --- LogSanitizer ---
/**
 * Helpers for normalizing and sanitizing log details.
 */
const LogSanitizer = (() => {
    const normalizeVideoToken = (value) => {
        if (typeof value !== 'string') return value;
        const match = value.match(/^video-(\d+)$/);
        if (!match) return value;
        return Number(match[1]);
    };

    const transformDetail = (input) => {
        if (Array.isArray(input)) {
            return input.map(transformDetail);
        }
        if (input && typeof input === 'object') {
            const result = {};
            Object.entries(input).forEach(([key, value]) => {
                if (key === 'videoId') {
                    result.video = normalizeVideoToken(value);
                    return;
                }
                const transformed = transformDetail(value);
                result[key] = normalizeVideoToken(transformed);
            });
            return result;
        }
        return normalizeVideoToken(input);
    };

    const stripKeys = (input, keys) => {
        if (Array.isArray(input)) {
            input.forEach(entry => stripKeys(entry, keys));
            return;
        }
        if (!input || typeof input !== 'object') return;
        Object.keys(input).forEach((key) => {
            if (keys.has(key)) {
                delete input[key];
            } else {
                stripKeys(input[key], keys);
            }
        });
    };

    const parseInlinePairs = (rest) => {
        if (!rest) return { prefix: rest, pairs: null };
        const tokens = rest.trim().split(/\s+/);
        const prefixTokens = [];
        const pairs = {};
        let inPairs = false;
        let lastKey = null;

        tokens.forEach((token) => {
            const eqIndex = token.indexOf('=');
            if (eqIndex > 0) {
                inPairs = true;
                const key = token.slice(0, eqIndex);
                const value = token.slice(eqIndex + 1);
                pairs[key] = value;
                lastKey = key;
                return;
            }
            if (!inPairs) {
                prefixTokens.push(token);
                return;
            }
            if (lastKey) {
                pairs[lastKey] = `${pairs[lastKey]} ${token}`;
            }
        });

        if (!inPairs) {
            return { prefix: rest, pairs: null };
        }
        return {
            prefix: prefixTokens.join(' ').trim(),
            pairs
        };
    };

    const mergeDetail = (inlinePairs, existing) => {
        if (!inlinePairs) return existing;
        if (!existing || typeof existing !== 'object') return inlinePairs;
        return { ...inlinePairs, ...existing };
    };

    const getRawTag = (message) => {
        if (!message || typeof message !== 'string') return null;
        const match = message.match(/^\[([^\]]+)\]/);
        return match ? match[1] : null;
    };

    const orderDetail = (detail, schema) => {
        if (!schema || !detail || typeof detail !== 'object' || Array.isArray(detail)) return detail;
        const ordered = {};
        schema.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(detail, key)) {
                ordered[key] = detail[key];
            }
        });
        Object.keys(detail).forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
                ordered[key] = detail[key];
            }
        });
        return ordered;
    };

    const sanitizeDetail = (detail, message, seenSrcByVideo) => {
        if (!detail || typeof detail !== 'object') return detail;
        const sanitized = transformDetail(detail);
        const detailMessage = typeof sanitized.message === 'string'
            ? sanitized.message
            : typeof sanitized.inlineMessage === 'string'
                ? sanitized.inlineMessage
                : '';
        const isVideoIntro = message.includes('[HEALER:VIDEO]')
            && detailMessage.includes('Video registered');
        const isSrcChange = message.includes('[HEALER:SRC]')
            || (message.includes('[HEALER:MEDIA_STATE]') && detailMessage.includes('src attribute changed'));
        const videoKey = sanitized.video ?? sanitized.videoState?.id ?? null;
        const allowSrc = isVideoIntro
            || (isSrcChange && videoKey !== null && !seenSrcByVideo.has(videoKey));

        if (isSrcChange && videoKey !== null) {
            seenSrcByVideo.add(videoKey);
        }

        if (!allowSrc) {
            stripKeys(sanitized, new Set(['currentSrc', 'src']));
        }
        if (message.includes('[HEALER:MEDIA_STATE]') && detailMessage.includes('src attribute changed')) {
            delete sanitized.previous;
            delete sanitized.current;
            sanitized.changed = true;
        }
        if (message.includes('[HEALER:SRC]')) {
            delete sanitized.previous;
            delete sanitized.current;
            sanitized.changed = true;
        }
        const rawTag = getRawTag(message);
        const schema = typeof LogSchemas !== 'undefined' ? LogSchemas.getSchema(rawTag) : null;
        return orderDetail(sanitized, schema);
    };

    return {
        normalizeVideoToken,
        transformDetail,
        stripKeys,
        parseInlinePairs,
        mergeDetail,
        sanitizeDetail,
        getRawTag,
        orderDetail
    };
})();
