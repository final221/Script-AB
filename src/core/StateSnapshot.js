// --- StateSnapshot ---
/**
 * Central helper for consistent video state snapshots.
 */
const StateSnapshot = (() => {
    const full = (video, videoId) => VideoState.get(video, videoId);
    const lite = (video, videoId) => VideoState.getLite(video, videoId);

    const format = (snapshot) => {
        if (!snapshot || snapshot.error) {
            return snapshot?.error || 'unknown';
        }
        const parts = [
            `currentTime=${snapshot.currentTime}`,
            `paused=${snapshot.paused}`,
            `readyState=${snapshot.readyState}`,
            `networkState=${snapshot.networkState}`,
            snapshot.buffered ? `buffered=${snapshot.buffered}` : `bufferedLength=${snapshot.bufferedLength}`
        ];
        return parts.filter(Boolean).join(' ');
    };

    return {
        full,
        lite,
        format
    };
})();
