// --- Mocking ---
/**
 * Handles the creation and application of mock responses for blocked requests.
 * @responsibility
 * 1. Generate mock responses for XHR and Fetch.
 * 2. Apply mocks to XHR objects.
 */
const Mocking = (() => {
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

    const getFetchMock = (url) => {
        const { body, type } = Logic.Network.getMock(url);
        Logger.add('Ad request blocked (FETCH)', { url });
        Metrics.increment('ads_blocked');
        return new Response(body, {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': type },
        });
    };

    return {
        mockXhrResponse,
        getFetchMock
    };
})();
