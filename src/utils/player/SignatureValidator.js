// --- Signature Validator ---
/**
 * Player signature validation and tracking.
 */
const SignatureValidator = (() => {
    // Session reference - shared across all signatures
    const sessionRef = { current: null };

    /**
     * Creates a signature validator with session tracking
     * @param {string} id - Signature ID (k0, k1, k2)
     * @param {number} argsLength - Expected function argument count
     * @returns {{id: string, check: Function}} Signature validator
     */
    const createSignature = (id, argsLength) => ({
        id,
        check: (o, k) => {
            try {
                const result = typeof o[k] === 'function' && o[k].length === argsLength;

                if (result && sessionRef.current) {
                    const session = sessionRef.current;

                    // Only log key changes after initial discovery period (500ms grace period)
                    const isInitialDiscovery = Date.now() - session.mountTime < 500;
                    if (session[id] && session[id] !== k && !isInitialDiscovery) {
                        const change = {
                            timestamp: Date.now(),
                            signatureId: id,
                            oldKey: session[id],
                            newKey: k,
                            timeSinceMount: Date.now() - session.mountTime
                        };

                        session.keyHistory.push(change);
                        Logger.add('[Logic] ⚠️ SIGNATURE KEY CHANGED DURING SESSION', change);
                    }

                    // Update session key
                    if (!session[id] || session[id] !== k) {
                        session[id] = k;
                        Logger.add('[Logic] Signature key set', {
                            id,
                            key: k,
                            sessionId: session.sessionId,
                            isChange: session[id] !== null
                        });
                    }
                }

                return result;
            } catch (e) {
                return false;
            }
        }
    });

    /**
     * Player function signatures
     */
    const signatures = [
        createSignature('k0', 1),
        createSignature('k1', 0),
        createSignature('k2', 0)
    ];

    /**
     * Validates an object property against a signature
     * @param {Object} obj - Object to validate
     * @param {string} key - Key to check
     * @param {Object} sig - Signature definition
     * @returns {boolean} True if valid
     */
    const validate = (obj, key, sig) =>
        Fn.tryCatch(() => typeof obj[key] === 'function' && sig.check(obj, key), () => false)();

    /**
     * Sets the current session for signature tracking
     * @param {Object} session - Session object
     */
    const setSession = (session) => {
        sessionRef.current = session;
    };

    return {
        signatures,
        validate,
        setSession
    };
})();
