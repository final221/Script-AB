// --- AdGapSignals ---
/**
 * Detects ad-gap-like buffered range gaps around stalled playheads.
 */
const AdGapSignals = (() => {
    const getEdgeThreshold = () => Math.max(0.25, CONFIG.recovery.HEAL_EDGE_GUARD_S || 0.25);

    const detectGap = (ranges, playheadSeconds, edgeThreshold) => {
        if (!ranges || ranges.length < 2 || !Number.isFinite(playheadSeconds)) return null;
        const threshold = Number.isFinite(edgeThreshold) ? edgeThreshold : getEdgeThreshold();
        for (let i = 0; i < ranges.length - 1; i++) {
            const range = ranges[i];
            const next = ranges[i + 1];
            if (playheadSeconds < range.start || playheadSeconds > range.end) {
                continue;
            }
            const gapSize = next.start - range.end;
            const nearEdge = Math.abs(range.end - playheadSeconds) <= threshold;
            if (gapSize > 0 && nearEdge) {
                return {
                    playheadSeconds,
                    rangeEnd: range.end,
                    nextRangeStart: next.start,
                    gapSize,
                    ranges
                };
            }
            break;
        }
        return null;
    };

    const maybeLog = (options = {}) => {
        const video = options.video;
        const videoId = options.videoId || 'unknown';
        const monitorState = options.monitorState;
        const playheadSeconds = options.playheadSeconds;
        if (!video || !Number.isFinite(playheadSeconds)) return null;

        const now = options.now || Date.now();
        const lastLog = monitorState?.lastAdGapSignatureLogTime || 0;
        if (now - lastLog < CONFIG.logging.BACKOFF_LOG_INTERVAL_MS) {
            return null;
        }

        const ranges = options.ranges || BufferGapFinder.getBufferRanges(video);
        const detection = detectGap(ranges, playheadSeconds, options.edgeThreshold);
        if (!detection) return null;

        if (monitorState) {
            monitorState.lastAdGapSignatureLogTime = now;
        }

        const formattedRanges = BufferGapFinder.formatRanges(detection.ranges);
        const summary = LogEvents.summary.adGapSignature({
            videoId,
            playheadSeconds: detection.playheadSeconds,
            rangeEnd: detection.rangeEnd,
            nextRangeStart: detection.nextRangeStart,
            gapSize: detection.gapSize,
            ranges: formattedRanges
        });

        Logger.add(summary, {
            videoId,
            reason: options.reason || null,
            playheadSeconds: Number(detection.playheadSeconds.toFixed(3)),
            rangeEnd: Number(detection.rangeEnd.toFixed(3)),
            nextRangeStart: Number(detection.nextRangeStart.toFixed(3)),
            gapSize: Number(detection.gapSize.toFixed(3)),
            ranges: formattedRanges
        });

        return detection;
    };

    return {
        detectGap,
        maybeLog
    };
})();
