const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// Create log file
const logFile = path.join(__dirname, 'last-run.log');
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

// Helper to log to both console and file
const log = (msg, ...args) => {
    console.log(msg, ...args);
    // Strip ANSI color codes for file
    const cleanMsg = String(msg).replace(/\x1b\[[0-9;]*m/g, '');
    logStream.write(cleanMsg + '\n');
};

(async () => {
    log('🧪 Starting automated test runner...');
    log('='.repeat(60));
    log('');

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
        logStream.write(text + '\n');

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
        const errorMsg = '❌ Page Error: ' + error.message;
        console.error('\x1b[31m' + errorMsg + '\x1b[0m');
        logStream.write(errorMsg + '\n');
    });

    // Load test runner
    const testFile = 'file://' + path.resolve(__dirname, 'test-runner.html');
    log(`📁 Loading test file: ${testFile}`);
    log('');

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

        log('');
        log(`⏱️  Duration: ${duration}s`);
        log(`📊 Tests: ${results.total} total`);
        log(`📝 Logger messages: ${results.loggerMessages}`);
        log('');

        if (results.failed > 0) {
            log('❌ Failed Tests:');
            results.failures.forEach(f => {
                console.log(`  \x1b[31m✗\x1b[0m ${f.name}`);
                logStream.write(`  ✗ ${f.name}\n`);
                console.log(`    \x1b[90m${f.error}\x1b[0m`);
                logStream.write(`    ${f.error}\n`);
            });
            log('');
        }

        // Summary with color
        if (results.failed === 0) {
            console.log('\x1b[32m✅ All tests passed!\x1b[0m');
            logStream.write('✅ All tests passed!\n');
        } else {
            console.log(`\x1b[31m❌ ${results.failed} test(s) failed\x1b[0m`);
            logStream.write(`❌ ${results.failed} test(s) failed\n`);
        }

        log('');
        log(`📄 Full log saved to: ${logFile}`);

        await browser.close();
        logStream.end();

        // Exit with appropriate code for CI/CD
        process.exit(results.failed > 0 ? 1 : 0);

    } catch (error) {
        const errorMsg = '\n❌ Test runner failed: ' + error.message;
        console.error('\x1b[31m' + errorMsg + '\x1b[0m');
        console.error(error.stack);
        logStream.write(errorMsg + '\n');
        logStream.write(error.stack + '\n');
        await browser.close();
        logStream.end();
        process.exit(1);
    }
})();
