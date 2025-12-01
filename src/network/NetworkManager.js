// --- Network Manager ---
/**
 * Orchestrates the hooking of XMLHttpRequest and fetch, delegating tasks to sub-modules.
 * @responsibility
 * 1. Hook XHR and Fetch.
 * 2. Delegate ad detection to AdBlocker.
 * 3. Delegate logging to Diagnostics.
 * 4. Delegate mocking to Mocking.
 */
const NetworkManager = (() => {
    const hookXHR = () => {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            if (method === 'GET' && typeof url === 'string') {
                const isAd = AdBlocker.process(url, 'XHR');

                // Auto-detect potential new patterns
                Logic.Network.detectNewPatterns(url);

                Diagnostics.logNetworkRequest(url, 'XHR', isAd);
                if (isAd) {
                    this._isAdRequest = true;
                }
            }
            originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            if (this._isAdRequest) {
                Mocking.mockXhrResponse(this, this._responseURL);
                return;
            }
            originalSend.apply(this, arguments);
        };
    };

    const hookFetch = () => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
            const url = (typeof input === 'string') ? input : input.url;
            if (url) {
                const isAd = AdBlocker.process(url, 'FETCH');

                // Auto-detect potential new patterns
                Logic.Network.detectNewPatterns(url);

                Diagnostics.logNetworkRequest(url, 'FETCH', isAd);
                if (isAd) {
                    return Promise.resolve(Mocking.getFetchMock(url));
                }
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
