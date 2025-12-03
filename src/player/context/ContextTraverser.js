// --- Context Traverser ---
/**
 * Traverses object trees to find player context.
 */
const ContextTraverser = (() => {
    const fallbackSelectors = ['.video-player__container', '.highwind-video-player', '[data-a-target="video-player"]'];

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

            if (SignatureDetector.detectPlayerSignatures(node)) {
                return node;
            }

            // Add children to queue
            for (const key of Object.keys(node)) {
                queue.push({ node: node[key], depth: depth + 1 });
            }
        }
        return null;
    };

    /**
     * Fallback strategy using DOM selectors
     * @returns {{ctx: Object, element: HTMLElement}|null} Found context and element
     */
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

    return {
        traverseForPlayerContext,
        findContextFallback
    };
})();
