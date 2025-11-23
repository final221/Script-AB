// ============================================================================
// 6. CORE ORCHESTRATOR
// ============================================================================
/**
 * Main entry point and event orchestrator.
 * @responsibility
 * 1. Initialize all modules.
 * 2. Observe DOM for player mounting/unmounting.
 * 3. Wire up EventBus listeners.
 */
const Core = {
    rootObserver: null,
    playerObserver: null,
    activeContainer: null,

    init: () => {
        Logger.add('Core initialized');
        if (window.self !== window.top) return;

        const { lastAttempt, errorCount } = Store.get();
        if (errorCount >= CONFIG.timing.LOG_THROTTLE && Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS) {
            if (CONFIG.debug) console.warn('[MAD-3000] Core throttled.');
            return;
        }

        NetworkManager.init();
        Instrumentation.init();
        Core.setupEvents();
        Core.setupScriptBlocker();

        if (document.body) {
            Core.startRootObservation();
        } else {
            document.addEventListener('DOMContentLoaded', () => Core.startRootObservation(), { once: true });
        }
    },

    setupScriptBlocker: () => {
        const scriptObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(n => {
                    if (n.tagName === 'SCRIPT' && n.src && (n.src.includes('supervisor.ext-twitch.tv') || n.src.includes('pubads.g.doubleclick.net'))) {
                        n.remove();
                        Logger.add('Blocked Script', { src: n.src });
                    }
                });
            }
        });
        scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
    },

    inject: () => {
        Store.update({ lastAttempt: Date.now() });
        Adapters.EventBus.emit(CONFIG.events.ACQUIRE);
    },

    setupEvents: () => {
        Adapters.EventBus.on(CONFIG.events.ACQUIRE, () => {
            if (Core.activeContainer) {
                if (PlayerContext.get(Core.activeContainer)) {
                    Logger.add('Event: ACQUIRE - Success');
                    HealthMonitor.start(Core.activeContainer);
                } else {
                    Logger.add('Event: ACQUIRE - Failed');
                }
            }
        });

        Adapters.EventBus.on(CONFIG.events.AD_DETECTED, () => {
            Logger.add('Event: AD_DETECTED');
            if (Core.activeContainer) Resilience.execute(Core.activeContainer);
        });
    },

    findAndMountPlayer: (node) => {
        if (node.nodeType !== 1) return;
        const player = node.matches(CONFIG.selectors.PLAYER) ? node : node.querySelector(CONFIG.selectors.PLAYER);
        if (player) Core.handlePlayerMount(player);
    },

    findAndUnmountPlayer: (node) => {
        if (Core.activeContainer && (node === Core.activeContainer || (node.contains && node.contains(Core.activeContainer)))) {
            Core.handlePlayerUnmount();
        }
    },

    startRootObservation: () => {
        const existing = Adapters.DOM.find(CONFIG.selectors.PLAYER);
        if (existing) Core.handlePlayerMount(existing);

        Core.rootObserver = Adapters.DOM.observe(document.body, (mutations) => {
            for (const m of mutations) {
                if (m.type === 'childList') {
                    m.addedNodes.forEach(Core.findAndMountPlayer);
                    m.removedNodes.forEach(Core.findAndUnmountPlayer);
                }
            }
        }, { childList: true, subtree: true });
    },

    handlePlayerMount: (container) => {
        if (Core.activeContainer === container) return;
        if (Core.activeContainer) Core.handlePlayerUnmount();

        Logger.add('Player mounted');
        Core.activeContainer = container;

        const debouncedInject = Fn.debounce(() => Core.inject(), 100);
        Core.playerObserver = Adapters.DOM.observe(container, (mutations) => {
            const shouldReacquire = mutations.some(m => {
                if (m.type === 'attributes' && m.attributeName === 'class' && m.target === container) return true;
                if (m.type === 'childList') {
                    const hasVideo = (nodes) => Array.from(nodes).some(n => n.matches && n.matches(CONFIG.selectors.VIDEO));
                    return hasVideo(m.addedNodes) || hasVideo(m.removedNodes);
                }
                return false;
            });
            if (shouldReacquire) debouncedInject();
        }, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        VideoListenerManager.attach(container);
        Core.inject();
    },

    handlePlayerUnmount: () => {
        if (!Core.activeContainer) return;
        Logger.add('Player unmounted');

        if (Core.playerObserver) {
            Core.playerObserver.disconnect();
            Core.playerObserver = null;
        }

        VideoListenerManager.detach();
        HealthMonitor.stop();
        PlayerContext.reset();
        Core.activeContainer = null;
    }
};

Core.init();
