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
                const tests = [
                    // Query parameter injection
                    { url: 'https://twitch.tv/ad_state/?x=1', expected: { isDelivery: true }, name: 'Delivery with query param' },
                    { url: 'https://twitch.tv/api?url=/ad_state/', expected: { isDelivery: false }, name: 'Query param injection (should NOT match)' },
                    { url: 'https://twitch.tv/video#/ad_state/', expected: { isDelivery: false }, name: 'Hash fragment (should NOT match)' },

                    // File extension matching  
                    { url: 'https://cdn.com/stream.m3u8?v=2', expected: { mockType: 'application/vnd.apple.mpegurl' }, name: 'M3U8 in pathname' },
                    { url: 'https://cdn.com/api?file=test.m3u8', expected: { mockType: 'application/json' }, name: 'M3U8 in query param (should NOT match)' },

                    // Availability check patterns
                    { url: 'https://twitch.tv/api?bp=preroll&channel=test', expected: { isAvailability: true }, name: 'Availability query param' },
                    { url: 'https://twitch.tv/bp=preroll', expected: { isAvailability: false }, name: 'Availability in pathname (should NOT match)' }
                ];

                Logger.add('========== URL PATTERN VALIDATION STARTED ==========');
                let passed = 0, failed = 0;

                tests.forEach((test, index) => {
                    const results = {
                        isDelivery: Logic.Network.isDelivery(test.url),
                        isAvailability: Logic.Network.isAvailabilityCheck(test.url),
                        mockType: Logic.Network.getMock(test.url).type
                    };

                    let testPassed = true;
                    const failures = [];

                    for (const [key, expected] of Object.entries(test.expected)) {
                        if (results[key] !== expected) {
                            testPassed = false;
                            failures.push(`${key}: expected ${expected}, got ${results[key]}`);
                        }
                    }

                    if (testPassed) {
                        passed++;
                        Logger.add(`[TEST ${index + 1}] ✓ PASSED: ${test.name}`, { url: test.url, results });
                    } else {
                        failed++;
                        Logger.add(`[TEST ${index + 1}] ✗ FAILED: ${test.name}`, { url: test.url, expected: test.expected, actual: results, failures });
                    }
                });

                const summary = `Tests Complete: ${passed} passed, ${failed} failed`;
                Logger.add(`========== ${summary} ==========`);
                console.log(summary);
                return { passed, failed, total: tests.length };
            };
        }
    };
})();

CoreOrchestrator.init();
