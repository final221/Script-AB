// --- Ad Analytics ---
/**
 * Tracks and analyzes ad detection and recovery correlation.
 * @responsibility
 * 1. Track ad detection events.
 * 2. Correlate health triggers with ad detections.
 * 3. Generate statistical reports on detection accuracy.
 */
const AdAnalytics = (() => {
    // Correlation tracking
    let lastAdDetectionTime = 0;
    let recoveryTriggersWithoutAds = 0;

    const init = () => {
        // 1. Listen for Health Triggers
        Adapters.EventBus.on(CONFIG.events.AD_DETECTED, (payload) => {
            if (payload.source === 'HEALTH') {
                // Health monitor triggered recovery
                const timeSinceLastAd = Date.now() - lastAdDetectionTime;

                // If > 10 seconds since last network detection, could be a missed ad
                if (timeSinceLastAd > 10000) {
                    recoveryTriggersWithoutAds++;

                    Logger.add('[CORRELATION] Recovery triggered without recent ad detection', {
                        trigger: payload.trigger,
                        reason: payload.reason,
                        timeSinceLastNetworkAd: (timeSinceLastAd / 1000).toFixed(1) + 's',
                        totalMissedCount: recoveryTriggersWithoutAds,
                        suggestion: 'Possible missed ad pattern or legitimate stuck state'
                    });
                }
            }
        });

        // 2. Listen for Log/Report Requests
        Adapters.EventBus.on(CONFIG.events.LOG, () => {
            generateCorrelationReport();
        });
    };

    const trackDetection = () => {
        lastAdDetectionTime = Date.now();
    };

    const generateCorrelationReport = () => {
        const adsDetected = Metrics.get('ads_detected');
        const healthTriggers = Metrics.get('health_triggers');

        const report = {
            ads_detected_network: adsDetected,
            health_triggered_recoveries: healthTriggers,
            recoveries_without_ads: recoveryTriggersWithoutAds,
            detection_accuracy: healthTriggers > 0 ?
                ((adsDetected / healthTriggers) * 100).toFixed(1) + '%' : 'N/A',
            interpretation: healthTriggers > adsDetected * 1.5 ?
                'ALERT: Health triggers significantly exceed ad detections - patterns may be incomplete' :
                'Normal: Ad detection appears accurate'
        };

        Logger.add('[CORRELATION] Statistical report', report);
        return report;
    };

    return {
        init,
        trackDetection,
        getCorrelationStats: () => ({
            lastAdDetectionTime,
            recoveryTriggersWithoutAds,
            ratio: recoveryTriggersWithoutAds > 0 ?
                recoveryTriggersWithoutAds / (Metrics.get('ads_detected') || 1) : 0
        })
    };
})();
