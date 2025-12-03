// --- Mock Generator ---
/**
 * Generates mock responses for intercepted ad requests.
 */
const MockGenerator = (() => {
    /**
     * Determines appropriate mock response based on URL
     * @param {string} url - URL to generate mock for
     * @returns {{body: string, type: string}} Mock response with body and MIME type
     */
    const getMock = (url) => {
        if (!url || typeof url !== 'string') {
            return { body: CONFIG.mock.JSON, type: 'application/json' };
        }

        const parsed = UrlParser.parseUrl(url);
        const pathname = parsed ? parsed.pathname : url;

        // Check file extension in pathname only (not query params)
        if (pathname.endsWith('.m3u8')) {
            return { body: CONFIG.mock.M3U8, type: 'application/vnd.apple.mpegurl' };
        }
        if (pathname.includes('vast') || pathname.endsWith('.xml')) {
            return { body: CONFIG.mock.VAST, type: 'application/xml' };
        }
        return { body: CONFIG.mock.JSON, type: 'application/json' };
    };

    return {
        getMock
    };
})();
