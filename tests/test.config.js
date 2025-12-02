/**
 * Test Runner Configuration
 * Centralizes configuration and allows environment overrides.
 */
module.exports = {
    // Test execution timeout in milliseconds
    timeout: process.env.TEST_TIMEOUT ? parseInt(process.env.TEST_TIMEOUT) : 30000,

    // Run browser in headless mode
    headless: process.env.HEADLESS !== 'false',

    // Chrome executable path (null = auto-detect/use bundled)
    executablePath: process.env.CHROME_PATH || null,

    // Logging level (info, debug, error)
    logLevel: process.env.LOG_LEVEL || 'info',

    // Files to exclude from test runner
    excludes: [],

    // Output paths
    paths: {
        template: 'tests/test-runner.template.html',
        output: 'tests/runner.html'
    }
};
