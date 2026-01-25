// --- LogContext ---
/**
 * Shared helper for consistent log payloads with video context.
 */
const LogContext = (() => {
    const normalizeDetail = (detail) => (
        detail && typeof detail === 'object' ? { ...detail } : {}
    );

    const withVideoState = (detail, snapshot, videoId) => {
        const payload = normalizeDetail(detail);
        if (payload.videoId === undefined && videoId) {
            payload.videoId = videoId;
        }
        if (payload.videoState === undefined && snapshot) {
            payload.videoState = snapshot;
        }
        return payload;
    };

    const fromContext = (context, detail) => (
        withVideoState(detail, context?.getLogSnapshot?.(), context?.videoId)
    );

    const fromVideo = (video, videoId, detail, mode = 'full') => {
        const snapshot = VideoStateSnapshot.forLog(video, videoId, mode);
        return withVideoState(detail, snapshot, videoId);
    };

    return {
        withVideoState,
        fromContext,
        fromVideo
    };
})();
