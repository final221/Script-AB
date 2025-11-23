// --- Script Blocker ---
/**
 * Blocks ad-related scripts from loading.
 * @responsibility Monitor DOM for ad script injections and remove them.
 */
const ScriptBlocker = (() => {
    const AD_SCRIPT_PATTERNS = [
        'supervisor.ext-twitch.tv',
        'pubads.g.doubleclick.net'
    ];

    const shouldBlock = (scriptNode) => {
        return scriptNode.tagName === 'SCRIPT' &&
            scriptNode.src &&
            AD_SCRIPT_PATTERNS.some(pattern => scriptNode.src.includes(pattern));
    };

    return {
        init: () => {
            const observer = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    m.addedNodes.forEach(n => {
                        if (shouldBlock(n)) {
                            n.remove();
                            Logger.add('Blocked Script', { src: n.src });
                        }
                    });
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    };
})();
