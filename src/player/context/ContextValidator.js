// --- Context Validator ---
/**
 * Validates player context cache and liveness.
 */
const ContextValidator = (() => {
    /**
     * Validates the cached context to ensure it's still usable.
     * @param {Object} cachedContext - The context to validate
     * @param {HTMLElement} cachedRootElement - The root element associated with the context
     * @returns {boolean} True if cache is valid, false otherwise
     */
    const validateCache = (cachedContext, cachedRootElement) => {
        if (!cachedContext) return false;

        // 1. DOM Attachment Check
        if (cachedRootElement && !cachedRootElement.isConnected) {
            Logger.add('PlayerContext: Cache invalid - Root element detached from DOM');
            return false;
        }

        // 2. Signature Function Check
        const keyMap = SignatureDetector.getKeyMap();
        const signaturesValid = Object.keys(keyMap).every(
            (key) => keyMap[key] && typeof cachedContext[keyMap[key]] === 'function'
        );

        if (!signaturesValid) {
            Logger.add('PlayerContext: Cache invalid - Signatures missing', { keyMap });
            return false;
        }

        // 3. Liveness Check (safe property access)
        try {
            // Test that context is actually accessible
            const testKey = keyMap.k0;
            if (testKey && cachedContext[testKey]) {
                // Context appears alive
            }
        } catch (e) {
            Logger.add('PlayerContext: Cache invalid - Liveness check failed', { error: String(e) });
            return false;
        }

        return true;
    };

    return {
        validateCache
    };
})();
