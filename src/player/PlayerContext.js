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
    let cachedRootElement = null; // Track the DOM element for validation
    let keyMap = { k0: null, k1: null, k2: null };
    const contextHintKeywords = ['react', 'vue', 'next', 'props', 'fiber', 'internal'];
    const fallbackSelectors = ['.video-player__container', '.highwind-video-player', '[data-a-target="video-player"]'];

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
     * Recursively traverses object tree to find the player context using Breadth-First Search (BFS).
     * Searches for React/Vue internal player component instance.
     * @param {Object} rootObj - Object to traverse
     * @returns {Object|null} Player context object if found, null otherwise
     */
    const traverseForPlayerContext = (rootObj) => {
        const queue = [{ node: rootObj, depth: 0 }];
        const visited = new WeakSet();

        while (queue.length > 0) {
            const { node, depth } = queue.shift();

            if (depth > CONFIG.player.MAX_SEARCH_DEPTH) continue;
            if (!node || typeof node !== 'object' || visited.has(node)) continue;

            visited.add(node);

            if (detectPlayerSignatures(node)) {
                return node;
            }

            // Add children to queue
            for (const key of Object.keys(node)) {
                queue.push({ node: node[key], depth: depth + 1 });
            }
        }
        return null;
    };

    const findContextFallback = () => {
        for (const selector of fallbackSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const key = Object.keys(el).find(k => k.startsWith('__reactInternalInstance') || k.startsWith('__reactFiber'));
                if (key && el[key]) {
                    const ctx = traverseForPlayerContext(el[key]);
                    if (ctx) return { ctx, element: el };
                }
            }
        }
        return null;
    };

    /**
     * Validates the cached context to ensure it's still usable.
     * @returns {boolean} True if cache is valid, false otherwise
     */
    const validateCache = () => {
        if (!cachedContext) return false;

        // 1. DOM Attachment Check
        if (cachedRootElement && !cachedRootElement.isConnected) {
            Logger.add('PlayerContext: Cache invalid - Root element detached from DOM');
            PlayerContext.reset();
            return false;
        }

        // 2. Signature Function Check
        const signaturesValid = Object.keys(keyMap).every(
            (key) => keyMap[key] && typeof cachedContext[keyMap[key]] === 'function'
        );

        if (!signaturesValid) {
            Logger.add('PlayerContext: Cache invalid - Signatures missing', { keyMap });
            PlayerContext.reset();
            return false;
        }

        return true;
    };

    return {
        get: (element) => {
            // Check if element is different from cached root
            if (element && cachedRootElement && element !== cachedRootElement) {
                Logger.add('PlayerContext: New element provided, resetting cache');
                PlayerContext.reset();
            }

            if (validateCache()) {
                return cachedContext;
            }
            if (!element) return null;

            // 1. Primary Strategy: Keyword Search on Root Element
            // Use Reflect.ownKeys to include Symbol properties, which React often uses.
            const keys = Reflect.ownKeys(element);

            for (const key of keys) {
                const keyString = String(key).toLowerCase();
                if (contextHintKeywords.some(hint => keyString.includes(hint))) {
                    const potentialContext = element[key];
                    if (potentialContext && typeof potentialContext === 'object') {
                        const ctx = traverseForPlayerContext(potentialContext);
                        if (ctx) {
                            cachedContext = ctx;
                            cachedRootElement = element;
                            Logger.add('PlayerContext: Success', { method: 'keyword', key: String(key) });
                            return ctx;
                        }
                    }
                }
            }

            // 2. Fallback Strategy: DOM Selectors
            const fallbackResult = findContextFallback();
            if (fallbackResult) {
                cachedContext = fallbackResult.ctx;
                cachedRootElement = fallbackResult.element;
                Logger.add('PlayerContext: Success', { method: 'fallback', element: fallbackResult.element });
                return fallbackResult.ctx;
            }

            Logger.add('PlayerContext: Scan failed - no context found');
            return null;
        },
        reset: () => {
            cachedContext = null;
            cachedRootElement = null;
            keyMap = { k0: null, k1: null, k2: null };
        },
    };
})();
