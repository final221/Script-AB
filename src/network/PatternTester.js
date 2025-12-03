/**
 * Handles validation of URL patterns against detection logic.
 * @responsibility
 * 1. Verify ad pattern matching logic.
 * 2. Verify availability check pattern matching.
 * 3. Provide test results for debugging.
 */
const PatternTester = (() => {
    return {
        test: () => {
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
        }
    };
})();
