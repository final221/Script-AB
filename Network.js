// --- Network ---
/**
 * Intercepts XHR and Fetch requests to detect and block ads.
 * @responsibility
 * 1. Monitor network traffic for ad patterns.
 * 2. Mock responses for blocked ads to prevent player errors.
 * 3. Emit AD_DETECTED events.
 */
const Network = (() => {
    const process = (url, type) => {
        if (Logic.Network.isTrigger(url)) {
            Logger.add('Trigger pattern detected', { type, url });
            Adapters.EventBus.emit(CONFIG.events.AD_DETECTED);
        }
        const isAd = Logic.Network.isAd(url);
        if (isAd) {
            Logger.add('Ad pattern detected', { type, url });
            Metrics.increment('ads_detected');
        }
        // Detailed logging is handled inside process to avoid duplication
        logNetworkRequest(url, type, isAd);
        return isAd;
    };

    const logNetworkRequest = (url, type, isAd) => {
        if (isAd) return;

        // --- START OF DIAGNOSTIC CHANGE ---
        // Temporarily increase logging to find new ad patterns.
        const isRelevant = url.includes('twitch') || url.includes('ttvnw') || url.includes('.m3u8');

        if (isRelevant && Math.random() < 0.25) { // Log 25% of relevant requests
            Logger.add('Network Request (DIAGNOSTIC)', { type, url });
        }
        // --- END OF DIAGNOSTIC CHANGE ---
    };

    /**
     * Mocks a response for a blocked XHR ad request.
     * !CRITICAL: Mocking responses is essential. If we just block the request,
     * the player will retry indefinitely or crash. We must return a valid,
     * empty response to satisfy the player's state machine.
     * @param {XMLHttpRequest} xhr The XHR object to mock.
     * @param {string} url The URL of the request.
     */
    const mockXhrResponse = (xhr, url) => {
        const { body } = Logic.Network.getMock(url);
        Logger.add('Ad request blocked (XHR)', { url });
        Metrics.increment('ads_blocked');

        Object.defineProperties(xhr, {
            readyState: { value: 4, writable: false },
            responseText: { value: body, writable: false },
            response: { value: body, writable: false },
            status: { value: 200, writable: false },
            statusText: { value: 'OK', writable: false },
        });

        queueMicrotask(() => {
            if (xhr.onreadystatechange) xhr.onreadystatechange();
            if (xhr.onload) xhr.onload();
        });
    };

    const hookXHR = () => {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            if (method === 'GET' && typeof url === 'string' && process(url, 'XHR')) {
                this._isAdRequest = true;
            }
            originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            if (this._isAdRequest) {
                mockXhrResponse(this, this._responseURL);
                return;
            }
            originalSend.apply(this, arguments);
        };
    };

    const hookFetch = () => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
            const url = (typeof input === 'string') ? input : input.url;
            if (url && process(url, 'FETCH')) {
                const { body, type } = Logic.Network.getMock(url);
                Logger.add('Ad request blocked (FETCH)', { url });
                Metrics.increment('ads_blocked');
                return Promise.resolve(new Response(body, {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'Content-Type': type },
                }));
            }
            return originalFetch(input, init);
        };
    };

    return {
        init: () => {
            hookXHR();
            hookFetch();
        },
    };
})();
