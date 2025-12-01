const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
    console.log('🧪 Starting automated test runner...');
    console.log('='.repeat(60));
    console.log('');

    const browser = await puppeteer.launch({
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Capture ALL console output with categorization
    const logs = [];
    page.on('console', msg => {
        const text = msg.text();
        logs.push(text);

        // Color code output
        if (text.includes('✅ PASS:')) {
            console.log('\x1b[32m%s\x1b[0m', text); // Green
        } else if (text.includes('❌ FAIL:')) {
            console.log('\x1b[31m%s\x1b[0m', text); // Red
        } else if (text.includes('🧪 Running:')) {
            console.log('\x1b[36m%s\x1b[0m', text); // Cyan
        } else if (text.includes('[DIAGNOSTICS]') || text.includes('[RECOVERY]') || text.includes('[HEALTH]')) {
            console.log('\x1b[90m  └─ %s\x1b[0m', text); // Gray (indented)
        } else if (text.includes('Test Summary')) {
            console.log('\n' + '='.repeat(60));
            console.log(text);
            console.log('='.repeat(60));
        } else {
            console.log('  ', text); // Indent non-test output
        }
    });

    // Capture errors
    page.on('pageerror', error => {
        console.error('\x1b[31m❌ Page Error:\x1b[0m', error.message);
    });

    // Load test runner
    const testFile = 'file://' + path.resolve(__dirname, 'test-runner.html');
    console.log(`📁 Loading test file: ${testFile}`);
    console.log('');

    const startTime = Date.now();

    try {
        await page.goto(testFile, { waitUntil: 'networkidle0' });

        // Wait for tests to complete
        await page.waitForFunction(
            () => document.body.textContent.includes('Test Summary'),
            { timeout: 30000 }
        );

        // Get detailed results
        const results = await page.evaluate(() => {
            return {
                passed: Test.results.filter(r => r.status === 'PASS').length,
                failed: Test.results.filter(r => r.status === 'FAIL').length,
                total: Test.results.length,
                failures: Test.results.filter(r => r.status === 'FAIL'),
                // Capture logger output
                loggerMessages: Logger.logs ? Logger.logs.length : 0
            };
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('');
        console.log(`⏱️  Duration: ${duration}s`);
        console.log(`📊 Tests: ${results.total} total`);
        console.log(`📝 Logger messages: ${results.loggerMessages}`);
        console.log('');

        if (results.failed > 0) {
            console.log('\x1b[31m❌ Failed Tests:\x1b[0m');
            results.failures.forEach(f => {
                console.log(`  \x1b[31m✗\x1b[0m ${f.name}`);
                console.log(`    \x1b[90m${f.error}\x1b[0m`);
            });
            console.log('');
        }

        // Summary with color
        if (results.failed === 0) {
            console.log('\x1b[32m✅ All tests passed!\x1b[0m');
        } else {
            console.log(`\x1b[31m❌ ${results.failed} test(s) failed\x1b[0m`);
        }

        await browser.close();

        // Exit with appropriate code for CI/CD
        process.exit(results.failed > 0 ? 1 : 0);

    } catch (error) {
        console.error('\n\x1b[31m❌ Test runner failed:\x1b[0m', error.message);
        console.error(error.stack);
        await browser.close();
        process.exit(1);
    }
})();
