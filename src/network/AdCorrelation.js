// --- Ad Correlation ---
/**
 * Tracks correlation between blocked ad requests and player health.
 * Helps measure effectiveness of ad blocking.
 */
const AdCorrelation = (() => {
    const recentBlocks = [];
    const MAX_HISTORY = 50;
    const CORRELATION_WINDOW_MS = 10000; // 10 seconds

    /**
     * Records a blocked ad request
     * @param {string} url - The blocked URL
     * @param {string} type - Request type (XHR/FETCH)
     */
    const recordBlock = (url, type) => {
        const record = {
            url: url.substring(0, 100), // Truncate for memory
            type,
            timestamp: Date.now(),
            playerHealthy: null // Will be updated by health checks
        };

        recentBlocks.push(record);

        // Trim old entries
        while (recentBlocks.length > MAX_HISTORY) {
            recentBlocks.shift();
        }

        Logger.add('[AdCorrelation] Block recorded', {
            type,
            urlPreview: url.substring(0, 80),
            totalBlocked: recentBlocks.length
        });
    };

    /**
     * Updates player health state for recent blocks
     * @param {boolean} isHealthy - Current player health state
     */
    const updatePlayerState = (isHealthy) => {
        const now = Date.now();
        let updated = 0;

        recentBlocks.forEach(block => {
            if (now - block.timestamp < CORRELATION_WINDOW_MS && block.playerHealthy === null) {
                block.playerHealthy = isHealthy;
                updated++;
            }
        });

        if (updated > 0) {
            Logger.add('[AdCorrelation] Player state updated for recent blocks', {
                isHealthy,
                blocksUpdated: updated
            });
        }
    };

    /**
     * Gets correlation statistics
     * @returns {Object} Stats about blocking effectiveness
     */
    const getStats = () => {
        const total = recentBlocks.length;
        const healthy = recentBlocks.filter(b => b.playerHealthy === true).length;
        const unhealthy = recentBlocks.filter(b => b.playerHealthy === false).length;
        const pending = recentBlocks.filter(b => b.playerHealthy === null).length;

        const stats = {
            totalBlocked: total,
            playerRemainedHealthy: healthy,
            playerBecameUnhealthy: unhealthy,
            pendingCorrelation: pending,
            effectivenessRate: total > 0 && (healthy + unhealthy) > 0
                ? ((healthy / (healthy + unhealthy)) * 100).toFixed(1) + '%'
                : 'N/A'
        };

        return stats;
    };

    /**
     * Exports full correlation data for analysis
     */
    const exportData = () => {
        const stats = getStats();
        Logger.add('[AdCorrelation] Correlation Export', {
            ...stats,
            recentBlocks: recentBlocks.slice(-10) // Last 10 for log
        });
        return {
            stats,
            blocks: [...recentBlocks]
        };
    };

    return {
        recordBlock,
        updatePlayerState,
        getStats,
        exportData
    };
})();
