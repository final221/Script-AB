// ============================================================================
// 6. CORE ORCHESTRATOR
// ============================================================================
/**
 * Main entry point - orchestrates module initialization.
 * @responsibility Initialize all modules in the correct order.
 */
const CoreOrchestrator = (() => {
    return {
        init: () => {
            Logger.add('Core initialized');

            // Don't run in iframes
            if (window.self !== window.top) return;

            // Check throttling
            const { lastAttempt, errorCount } = Store.get();
            if (errorCount >= CONFIG.timing.LOG_THROTTLE &&
                Date.now() - lastAttempt < CONFIG.timing.REATTEMPT_DELAY_MS) {
                if (CONFIG.debug) {
                    console.warn('[MAD-3000] Core throttled.');
                }
                return;
            }

            // Initialize modules in order
            NetworkManager.init();
            Instrumentation.init();
            EventCoordinator.init();
            ScriptBlocker.init();
            AdBlocker.init();

            // Plan B: Initialize live pattern updates
            if (CONFIG.experimental?.ENABLE_LIVE_PATTERNS &&
                typeof PatternUpdater !== 'undefined') {
                PatternUpdater.init();
                Logger.add('[Core] PatternUpdater initialized');
            }

            // Wait for DOM if needed
            if (document.body) {
                DOMObserver.init();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    DOMObserver.init();
                }, { once: true });
            }

            // Expose debug triggers
            window.forceTwitchAdRecovery = () => {
                Logger.add('Manual recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, { source: 'MANUAL_TRIGGER' });
            };

            window.forceTwitchAggressiveRecovery = () => {
                Logger.add('Manual AGGRESSIVE recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'MANUAL_TRIGGER',
                    forceAggressive: true
                });
            };

            // Experimental recovery controls
            window.toggleExperimentalRecovery = (enable) => {
                ExperimentalRecovery.setEnabled(enable);
            };

            window.testExperimentalStrategy = (strategyName) => {
                const video = document.querySelector('video');
                if (video) {
                    ExperimentalRecovery.testStrategy(video, strategyName);
                } else {
                    console.log('No video element found');
                }
            };

            window.forceTwitchExperimentalRecovery = () => {
                Logger.add('Manual EXPERIMENTAL recovery triggered via console');
                Adapters.EventBus.emit(CONFIG.events.AD_DETECTED, {
                    source: 'MANUAL_TRIGGER',
                    forceExperimental: true
                });
            };

            window.testTwitchAdPatterns = () => {
                if (typeof PatternTester !== 'undefined') {
                    return PatternTester.test();
                } else {
                    console.error('PatternTester module not loaded');
                    return { error: 'Module not loaded' };
                }
            };

            // Plan B: PatternUpdater controls
            window.updateTwitchAdPatterns = () => {
                if (typeof PatternUpdater !== 'undefined') {
                    Logger.add('Manual pattern update triggered');
                    return PatternUpdater.forceUpdate();
                }
                return { error: 'PatternUpdater not loaded' };
            };

            window.getTwitchPatternStats = () => {
                if (typeof PatternUpdater !== 'undefined') {
                    return PatternUpdater.getStats();
                }
                return { error: 'PatternUpdater not loaded' };
            };

            window.addTwitchPatternSource = (url) => {
                if (typeof PatternUpdater !== 'undefined') {
                    PatternUpdater.addSource(url);
                    return PatternUpdater.forceUpdate();
                }
                return { error: 'PatternUpdater not loaded' };
            };

            // Plan B: PlayerPatcher controls (experimental)
            window.enableTwitchPlayerPatcher = () => {
                if (typeof PlayerPatcher !== 'undefined') {
                    PlayerPatcher.enable();
                    Logger.add('[Core] PlayerPatcher enabled via console');
                    return PlayerPatcher.getStats();
                }
                return { error: 'PlayerPatcher not loaded' };
            };

            window.disableTwitchPlayerPatcher = () => {
                if (typeof PlayerPatcher !== 'undefined') {
                    PlayerPatcher.disable();
                    return { disabled: true };
                }
                return { error: 'PlayerPatcher not loaded' };
            };

            window.getTwitchPlayerPatcherStats = () => {
                if (typeof PlayerPatcher !== 'undefined') {
                    return PlayerPatcher.getStats();
                }
                return { error: 'PlayerPatcher not loaded' };
            };

            // Expose AdCorrelation stats
            window.getTwitchAdCorrelationStats = () => {
                if (typeof AdCorrelation !== 'undefined') {
                    return AdCorrelation.exportData();
                }
                return { error: 'AdCorrelation not loaded' };
            };
        }
    };
})();

CoreOrchestrator.init();

