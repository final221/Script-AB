// --- Player Context ---
/**
 * React/Vue internal state scanner.
 * @responsibility Finds the internal React/Vue component instance associated with the DOM element.
 */
const PlayerContext = (() => {
    let cachedContext = null;
    let cachedRootElement = null;
    const contextHintKeywords = ['react', 'vue', 'next', 'props', 'fiber', 'internal'];

    /**
     * Resets the cache and signature detector
     */
    const reset = () => {
        cachedContext = null;
        cachedRootElement = null;
        SignatureDetector.reset();
    };

    /**
     * Get player context for a DOM element
     * @param {HTMLElement} element - Player container element
     * @returns {Object|null} Player context object, or null if not found
     */
    const get = (element) => {
        // Check if element is different from cached root
        if (element && cachedRootElement && element !== cachedRootElement) {
            Logger.add('PlayerContext: New element provided, resetting cache');
            reset();
        }

        if (ContextValidator.validateCache(cachedContext, cachedRootElement)) {
            return cachedContext;
        }
        if (!element) return null;

        // 1. Primary Strategy: Keyword Search on Root Element
        const keys = Reflect.ownKeys(element);

        for (const key of keys) {
            const keyString = String(key).toLowerCase();
            if (contextHintKeywords.some(hint => keyString.includes(hint))) {
                const potentialContext = element[key];
                if (potentialContext && typeof potentialContext === 'object') {
                    const ctx = ContextTraverser.traverseForPlayerContext(potentialContext);
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
        const fallbackResult = ContextTraverser.findContextFallback();
        if (fallbackResult) {
            cachedContext = fallbackResult.ctx;
            cachedRootElement = fallbackResult.element;
            Logger.add('PlayerContext: Success', { method: 'fallback', element: fallbackResult.element });
            return fallbackResult.ctx;
        }

        Logger.add('PlayerContext: Scan failed - no context found');
        return null;
    };

    return {
        get,
        reset
    };
})();
