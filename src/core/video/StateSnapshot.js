// --- StateSnapshot ---
/**
 * Central helper for consistent video state snapshots.
 */
const StateSnapshot = (() => {
    const full = (video, videoId) => VideoStateSnapshot.full(video, videoId, { compactSrc: false });
    const lite = (video, videoId) => VideoStateSnapshot.lite(video, videoId, { compactSrc: false });

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
