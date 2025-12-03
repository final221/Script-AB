const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const CONFIG = require('./test.config.js');

// Create log file
const logFile = path.join(__dirname, 'last-run.log');
const logStream = createWriteStream(logFile, { flags: 'w' });

// Helper to log to both console and file
const log = (msg, ...args) => {
    console.log(msg, ...args);
    // Strip ANSI color codes for file
    const cleanMsg = String(msg).replace(/\x1b\[[0-9;]*m/g, '');
    logStream.write(cleanMsg + '\n');
};

/**
 * Recursively gets all files in a directory.
 * @param {string} dir - The directory to search.
 * @returns {Promise<string[]>} List of absolute file paths.
 */
const getFiles = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => {
        const res = path.resolve(dir, entry.name);
        return entry.isDirectory() ? getFiles(res) : res;
    }));
    return files.flat();
};

/**
 * Generates the test runner HTML file dynamically.
 */
const generateTestRunner = async () => {
    log('🔨 Generating test runner...');

    const baseDir = path.join(__dirname, '..');
    const srcDir = path.join(baseDir, 'src');

    // Build configuration (mirrors build/build.js logic)
    const PRIORITY = [
        'config/Config.js',
        'utils/Utils.js',
        'utils/Adapters.js',
        // Network modules (must load before _NetworkLogic)
        'utils/network/UrlParser.js',
        'utils/network/AdDetection.js',
        'utils/network/MockGenerator.js',
        'utils/network/PatternDiscovery.js',
        // Player modules (must load before _PlayerLogic)
        'utils/player/SignatureValidator.js',
        'utils/player/SessionManager.js',
        // Player Context modules (dependency order)
        'player/context/SignatureDetector.js',
        'player/context/ContextTraverser.js',
        'player/context/ContextValidator.js',
        // Resilience Orchestrator helpers
        'recovery/helpers/VideoSnapshotHelper.js',
        'recovery/helpers/RecoveryValidator.js',
        'recovery/helpers/AVSyncRouter.js',
        // Play Retry helpers
        'recovery/retry/PlayValidator.js',
        'recovery/retry/MicroSeekStrategy.js',
        'recovery/retry/PlayExecutor.js',
        // Aggregators
        'utils/_NetworkLogic.js',
        'utils/_PlayerLogic.js',
        'utils/Logic.js'
    ];
    const ENTRY = 'core/CoreOrchestrator.js';

    const allFiles = await getFiles(srcDir);
    const normalize = p => path.normalize(p);

    const priorityFiles = PRIORITY.map(file => path.join(srcDir, file));
    const entryFile = path.join(srcDir, ENTRY);

    // Filter and sort files
    const sourceFiles = allFiles.filter(file => {
        if (!file.endsWith('.js')) return false;
        if (CONFIG.excludes.some(ex => file.includes(ex))) return false;

        const isPriority = priorityFiles.some(p => normalize(p) === normalize(file));
        if (isPriority) return false;

        const isEntry = normalize(file) === normalize(entryFile);
        if (isEntry) return false;

        return true;
    });

    // Combine priority files, other files, and entry file last
    const finalFiles = [...priorityFiles, ...sourceFiles, entryFile];

    // Generate script tags
    const scriptTags = finalFiles.map(file => {
        // Create relative path from tests/ folder to src/ file
        const relativePath = path.relative(__dirname, file).replace(/\\/g, '/');
        return `    <script src="${relativePath}"></script>`;
    }).join('\n');

    // Read template and inject scripts
    let template = await fs.readFile(CONFIG.paths.template, 'utf8');
    const outputContent = template.replace('<!-- INJECT_SCRIPTS -->', scriptTags);

    await fs.writeFile(CONFIG.paths.output, outputContent);
    log(`✅ Generated ${CONFIG.paths.output} with ${finalFiles.length} source files`);
};

const cleanupResources = async (browser, stream, error) => {
    if (error) {
        const msg = `\n❌ Test runner failed: ${error.message}`;
        console.error('\x1b[31m' + msg + '\x1b[0m');
        if (error.stack) console.error(error.stack);
        try { stream?.write(msg + '\n'); } catch { }
    }

    if (browser) {
        try {
            await browser.close();
            log('🔒 Browser closed');
        } catch (e) {
            console.error('Error closing browser:', e.message);
        }
    }

    if (stream) {
        try {
            stream.end();
        } catch (e) {
            console.error('Error closing log stream:', e.message);
        }
    }
};

(async () => {
    log('🧪 Starting automated test runner...');
    log('='.repeat(60));

    let browser = null;

    try {
        await generateTestRunner();

        const launchOptions = {
            headless: CONFIG.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--allow-file-access-from-files' // Important for ES modules over file://
            ]
        };

        // puppeteer-core requires explicit path, so fallback to default Windows Chrome
        if (CONFIG.executablePath) {
            launchOptions.executablePath = CONFIG.executablePath;
            log(`Using configured Chrome: ${CONFIG.executablePath}`);
        } else {
            launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
            log(`Using default Chrome path: ${launchOptions.executablePath}`);
        }

        browser = await puppeteer.launch(launchOptions);
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
        const testFile = 'file://' + path.resolve(CONFIG.paths.output);
        log(`📁 Loading test file: ${testFile}`);
        log('');

        await page.goto(testFile, { waitUntil: 'networkidle0' });

        // Wait for tests to complete using the explicit flag
        await page.waitForFunction(
            () => window.__TEST_COMPLETE__ === true,
            { timeout: CONFIG.timeout }
        );

        // Get results
        const results = await page.evaluate(() => window.__TEST_RESULTS__);

        log('');
        if (results.failed === 0) {
            console.log('\x1b[32m✅ All tests passed!\x1b[0m');
            logStream.write('✅ All tests passed!\n');
        } else {
            console.log(`\x1b[31m❌ ${results.failed} test(s) failed\x1b[0m`);
            logStream.write(`❌ ${results.failed} test(s) failed\n`);
        }

        log('');
        log(`📄 Full log saved to: ${logFile}`);

        await cleanupResources(browser, logStream);
        process.exit(results.failed > 0 ? 1 : 0);

    } catch (error) {
        await cleanupResources(browser, logStream, error);
        process.exit(1);
    }
})();
