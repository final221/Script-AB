// --- Logger ---
/**
 * Logging and telemetry collection with console capture for timeline correlation.
 * @exports add, captureConsole, getMergedTimeline, getLogs, getConsoleLogs
 */
const Logger = (() => {
    const logs = [];
    const consoleLogs = [];
    const placeholderVideos = new Map();
    const placeholderSuppression = {
        count: 0,
        windowStartAt: 0,
        sampleIds: new Set()
    };
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
        if (match) return match[1];
        return value;
    };

    const extractVideoId = (detail) => {
        if (!detail || typeof detail !== 'object') return null;
        return normalizeVideoId(detail.videoId ?? detail.video ?? detail.videoState?.id);
    };

    const extractStateSnapshot = (detail) => {
        if (!detail || typeof detail !== 'object') return null;
        if (detail.videoState && typeof detail.videoState === 'object') {
            return detail.videoState;
        }
        const keys = ['readyState', 'networkState', 'currentSrc', 'src', 'buffered', 'currentTime', 'paused', 'duration'];
        if (keys.some(key => Object.prototype.hasOwnProperty.call(detail, key))) {
            return detail;
        }
        return null;
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
        if (raw.startsWith('HEALER:')) return raw.slice(7);
        return raw;
    };

    const buildSuppressionSummary = (windowMs, sampleIds, count) => {
        const summaryTag = (typeof LogTags !== 'undefined' && LogTags?.TAG?.SUPPRESSION)
            ? LogTags.TAG.SUPPRESSION
            : '[HEALER:SUPPRESSION_SUMMARY]';
        const samples = Array.from(sampleIds || []);
        return {
            message: summaryTag,
            detail: {
                message: 'Suppressed placeholder refresh cycles',
                reason: 'no_source',
                count,
                sampleVideos: samples,
                windowMs
            }
        };
    };

    const maybeSuppressPlaceholder = (message, detail) => {
        const videoId = extractVideoId(detail);
        const state = extractStateSnapshot(detail);
        const now = Date.now();

        if (videoId && state) {
            if (isPlaceholderState(state)) {
                placeholderVideos.set(videoId, now);
            } else if (placeholderVideos.has(videoId)) {
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

        if (!placeholderSuppression.windowStartAt) {
            placeholderSuppression.windowStartAt = now;
        }
        placeholderSuppression.count += 1;
        if (placeholderSuppression.sampleIds.size < PLACEHOLDER_SAMPLE_MAX) {
            placeholderSuppression.sampleIds.add(videoId);
        }

        const windowMs = now - placeholderSuppression.windowStartAt;
        const intervalMs = CONFIG?.logging?.SUPPRESSION_LOG_MS || 300000;
        if (placeholderSuppression.count >= PLACEHOLDER_SUPPRESSION_THRESHOLD || windowMs >= intervalMs) {
            const summary = buildSuppressionSummary(windowMs, placeholderSuppression.sampleIds, placeholderSuppression.count);
            placeholderSuppression.count = 0;
            placeholderSuppression.windowStartAt = 0;
            placeholderSuppression.sampleIds.clear();
            return { suppress: true, emit: summary };
        }

        return { suppress: true };
    };

    const normalizeInput = (message, detail) => {
        if (message && typeof message === 'object' && message.message) {
            const mergedDetail = (message.detail && typeof message.detail === 'object')
                ? { ...message.detail }
                : {};
            if (detail && typeof detail === 'object') {
                Object.entries(detail).forEach(([key, value]) => {
                    if (value === undefined) return;
                    mergedDetail[key] = value;
                });
            }
            return {
                message: message.message,
                detail: Object.keys(mergedDetail).length ? mergedDetail : null
            };
        }
        return { message, detail };
    };

    const pushLog = (message, detail) => {
        if (logs.length >= CONFIG.logging.MAX_LOGS) logs.shift();
        if (typeof LogNormalizer !== 'undefined' && LogNormalizer?.buildInternalEvent) {
            logs.push(LogNormalizer.buildInternalEvent(message, detail));
            return;
        }
        logs.push({
            timestamp: new Date().toISOString(),
            type: 'internal',
            message,
            detail,
        });
    };

    /**
     * Add an internal log entry.
     * @param {string} message - Log message (use prefixes like [HEALER:*], [CORE:*])
     * @param {Object|null} detail - Optional structured data
     */
    const add = (message, detail = null) => {
        const normalized = normalizeInput(message, detail);
        const suppression = maybeSuppressPlaceholder(normalized.message, normalized.detail);
        if (suppression?.emit) {
            pushLog(suppression.emit.message, suppression.emit.detail);
        }
        if (suppression?.suppress) {
            return;
        }
        pushLog(normalized.message, normalized.detail);
    };

    /**
     * Capture console output for timeline correlation.
     * Called by Instrumentation module.
     * @param {'log'|'info'|'debug'|'warn'|'error'} level
     * @param {any[]} args - Console arguments
     */
    const captureConsole = (level, args) => {
        if (consoleLogs.length >= CONFIG.logging.MAX_CONSOLE_LOGS) consoleLogs.shift();

        let message;
        try {
            message = args.map(arg => {
                if (typeof arg === 'string') return arg;
                if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                try { return JSON.stringify(arg); } catch { return String(arg); }
            }).join(' ');

            if (message.length > CONFIG.logging.CONSOLE_CAPTURE_MAX_LEN) {
                message = message.substring(0, CONFIG.logging.CONSOLE_CAPTURE_MAX_LEN) + '... [truncated]';
            }
        } catch {
            message = '[Unable to stringify console args]';
        }

        let detail = null;
        if (typeof LogNormalizer !== 'undefined' && LogNormalizer?.buildConsoleEvent) {
            consoleLogs.push(LogNormalizer.buildConsoleEvent(level, message));
            return;
        }
        if (typeof LogNormalizer !== 'undefined' && LogNormalizer?.normalizeConsole) {
            const normalized = LogNormalizer.normalizeConsole(level, message);
            message = normalized.message;
            detail = normalized.detail;
        }

        consoleLogs.push({
            timestamp: new Date().toISOString(),
            type: 'console',
            level,
            message,
            detail,
        });
    };

    /**
     * Get merged timeline of script logs + console logs, sorted chronologically.
     * @returns {Array<{timestamp, type, source, message, level?, detail?}>}
     */
    const getMergedTimeline = () => {
        const allLogs = [
            ...logs.map(l => ({ ...l, source: 'SCRIPT' })),
            ...consoleLogs.map(l => ({ ...l, source: 'CONSOLE' }))
        ];
        allLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return allLogs;
    };

    return {
        add,
        captureConsole,
        getLogs: () => logs,
        getConsoleLogs: () => consoleLogs,
        getMergedTimeline,
    };
})();


