const puppeteer = require('puppeteer-core');
const path = require('path');

/**
 * Browser Runner Module
 * Launches browser and executes tests.
 */

/**
 * Runs tests in a puppeteer browser.
 * @param {string} testFilePath - Path to test runner HTML
 * @param {Object} config - Test configuration
 * @param {Object} logStream - Log file stream
 * @param {Function} log - Logging function
 * @returns {Promise<{browser: Object, results: Object}>}
 */
const runTests = async (testFilePath, config, logStream, log) => {
    const launchOptions = {
        headless: config.headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--allow-file-access-from-files' // Important for ES modules over file://
        ]
    };

    // puppeteer-core requires explicit path, so fallback to default Windows Chrome
    if (config.executablePath) {
        launchOptions.executablePath = config.executablePath;
        log(`Using configured Chrome: ${config.executablePath}`);
    } else {
        launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        log(`Using default Chrome path: ${launchOptions.executablePath}`);
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Capture ALL console output with categorization
    page.on('console', msg => {
        const text = msg.text();
        logStream.write(text + '\n');

        // Color code output
        if (text.includes('✅ PASS:')) {
            console.log('\x1b[32m%s\x1b[0m', text); // Green
        } else if (text.includes('❌ FAIL:')) {
            console.log('\x1b[31m%s\x1b[0m', text); // Red
        } else if (text.includes('🧪 Running:')) {
            console.log('\x1b[36m%s\x1b[0m', text); // Cyan
        } else if (text.includes('TEST SUMMARY')) {
            console.log('\n' + '='.repeat(60));
            console.log(text);
        } else if (text.includes('Total:') || text.includes('Passed:') || text.includes('Failed:') || text.includes('Time:')) {
            console.log(text);
        } else {
            // Default log
            console.log('  ', text);
        }
    });

    // Capture errors
    page.on('pageerror', error => {
        const errorMsg = '❌ Page Error: ' + error.message;
        console.error('\x1b[31m' + errorMsg + '\x1b[0m');
        logStream.write(errorMsg + '\n');
    });

    // Load test runner
    const testFile = 'file://' + path.resolve(testFilePath);
    log(`📁 Loading test file: ${testFile}`);
    log('');

    await page.goto(testFile, { waitUntil: 'networkidle0' });

    // Wait for tests to complete using the explicit flag
    await page.waitForFunction(
        () => window.__TEST_COMPLETE__ === true,
        { timeout: config.timeout }
    );

    // Get results
    const results = await page.evaluate(() => window.__TEST_RESULTS__);

    return { browser, results };
};

module.exports = {
    runTests
};
