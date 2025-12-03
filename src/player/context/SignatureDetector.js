// --- Signature Detector ---
/**
 * Detects player function signatures in objects.
 */
const SignatureDetector = (() => {
    // Key map to cache found signature keys
    const keyMap = { k0: null, k1: null, k2: null };

    /**
     * Detects player function signatures in an object.
     * Attempts to match object properties against known player method signatures.
     * @param {Object} obj - Object to scan for player signatures
     * @returns {boolean} True if all required signatures were found
     */
    const detectPlayerSignatures = (obj) => {
        for (const sig of Logic.Player.signatures) {
            // If a key is already mapped and still valid, skip searching for it again.
            if (keyMap[sig.id] && Logic.Player.validate(obj, keyMap[sig.id], sig)) {
                continue;
            }
            const foundKey = Object.keys(obj).find(k => Logic.Player.validate(obj, k, sig));
            if (foundKey) {
                keyMap[sig.id] = foundKey;
                Logger.add('Player signature found', { id: sig.id, key: foundKey });
            }
        }
        return Object.values(keyMap).every(k => k !== null);
    };

    /**
     * Resets the key map
     */
    const reset = () => {
        keyMap.k0 = null;
        keyMap.k1 = null;
        keyMap.k2 = null;
    };

    /**
     * Gets the current key map
     * @returns {Object} Key map
     */
    const getKeyMap = () => keyMap;

    return {
        detectPlayerSignatures,
        reset,
        getKeyMap
    };
})();
