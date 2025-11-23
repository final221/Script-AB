// --- Player Context ---
/**
 * React/Vue internal state scanner.
 * @responsibility Finds the internal React/Vue component instance associated with the DOM element.
 * @invariant This is a heuristic search; it may fail if Twitch changes their internal property names.
 * @volatile This module relies on obfuscated property names (k0, k1, k2). 
 *           If the script fails, CHECK THIS MODULE FIRST.
 */
const PlayerContext = (() => {
    let cachedContext = null;
    let keyMap = { k0: null, k1: null, k2: null };
    const contextHintKeywords = ['react', 'vue', 'next', 'props', 'fiber', 'internal'];

    const findKeysInObject = (obj) => {
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

    const searchRecursive = (obj, depth = 0, visited = new WeakSet()) => {
        if (depth > CONFIG.player.MAX_SEARCH_DEPTH || !obj || typeof obj !== 'object' || visited.has(obj)) {
            return null;
        }
        visited.add(obj);

        if (findKeysInObject(obj)) {
            return obj;
        }

        for (const key of Object.keys(obj)) {
            const found = searchRecursive(obj[key], depth + 1, visited);
            if (found) return found;
        }
        return null;
    };

    const validateCache = () => {
        if (!cachedContext) return false;
        const isValid = Object.keys(keyMap).every(
            (key) => keyMap[key] && typeof cachedContext[keyMap[key]] === 'function'
        );
        if (!isValid) {
            Logger.add('PlayerContext: ⚠️ CACHED CONTEXT INVALID', { keyMap });
            PlayerContext.reset();
            return false;
        }
        return true;
    };

    return {
        get: (element) => {
            if (validateCache()) {
                return cachedContext;
            }
            if (!element) return null;

            // Use Reflect.ownKeys to include Symbol properties, which React often uses.
            const keys = Reflect.ownKeys(element);

            for (const key of keys) {
                // Check if the property key contains any of our hints.
                const keyString = String(key).toLowerCase();
                if (contextHintKeywords.some(hint => keyString.includes(hint))) {
                    const potentialContext = element[key];
                    if (potentialContext && typeof potentialContext === 'object') {
                        const ctx = searchRecursive(potentialContext);
                        if (ctx) {
                            cachedContext = ctx;
                            Logger.add('PlayerContext: Fresh context found via keyword search', { key: String(key) });
                            return ctx;
                        }
                    }
                }
            }

            Logger.add('PlayerContext: Scan failed - no context found');
            return null;
        },
        reset: () => {
            cachedContext = null;
            keyMap = { k0: null, k1: null, k2: null };
        },
    };
})();
