// --- Diagnostics ---
/**
 * Handles network traffic logging and diagnostics.
 * ENHANCED: Always logs video-related requests for debugging stream issues.
 */
const Diagnostics = (() => {
    // Track video request activity
    let lastVideoRequestTime = 0;
    let videoRequestCount = 0;
    let m3u8RequestCount = 0;

    const logNetworkRequest = (url, type, isAd) => {
        if (isAd) {
            // Always log blocked ads
            Logger.add('[NETWORK:BLOCKED] Ad request blocked', { type, url: url.substring(0, 100) });
            return;
        }

        const urlLower = url.toLowerCase();

        // ALWAYS log video-related requests (m3u8, video segments)
        const isM3U8 = urlLower.includes('.m3u8');
        const isVideoSegment = urlLower.includes('video-weaver') ||
            urlLower.includes('video-edge') ||
            urlLower.includes('.ts') ||
            urlLower.includes('segment');

        if (isM3U8) {
            m3u8RequestCount++;
            lastVideoRequestTime = Date.now();
            Logger.add('[NETWORK:M3U8] Manifest request', {
                type,
                url: url.substring(0, 150),
                totalM3U8: m3u8RequestCount
            });
            return;
        }

        if (isVideoSegment) {
            videoRequestCount++;
            lastVideoRequestTime = Date.now();
            // Log every 10th segment to avoid spam, but always log first few
            if (videoRequestCount <= 5 || videoRequestCount % 10 === 0) {
                Logger.add('[NETWORK:SEGMENT] Video segment request', {
                    type,
                    url: url.substring(0, 100),
                    segmentCount: videoRequestCount
                });
            }
            return;
        }

        // Sample other Twitch/ttvnw requests at 10%
        const isRelevant = urlLower.includes('twitch') || urlLower.includes('ttvnw');
        if (isRelevant && Math.random() < 0.10) {
            Logger.add('[NETWORK:OTHER] Request', { type, url: url.substring(0, 100) });
        }
    };

    // Helper to check video stream health
    const getVideoStreamStats = () => ({
        lastVideoRequestMs: lastVideoRequestTime ? Date.now() - lastVideoRequestTime : null,
        videoSegments: videoRequestCount,
        manifests: m3u8RequestCount
    });

    return {
        logNetworkRequest,
        getVideoStreamStats
    };
})();

