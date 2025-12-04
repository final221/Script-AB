// --- Network Logic Module ---
/**
 * Aggregates all network-related utilities.
 */
const _NetworkLogic = (() => {
    return {
        // UrlParser
        _parseUrl: UrlParser.parseUrl,
        _pathMatches: UrlParser.pathMatches,

        // AdDetection
        isAd: AdDetection.isAd,
        isTrigger: AdDetection.isTrigger,
        isDelivery: AdDetection.isDelivery,
        isAvailabilityCheck: AdDetection.isAvailabilityCheck,

        // MockGenerator
        getMock: MockGenerator.getMock,

        // PatternDiscovery
        detectNewPatterns: PatternDiscovery.detectNewPatterns,
        getDiscoveredPatterns: PatternDiscovery.getDiscoveredPatterns,
        exportCapturedUrls: PatternDiscovery.exportCapturedUrls,
        clearCaptured: PatternDiscovery.clearCaptured
    };
})();
