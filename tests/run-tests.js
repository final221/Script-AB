const path = require('path');
const { createWriteStream } = require('fs');
const CONFIG = require('./test.config.js');
const { getFiles, filterSourceFiles } = require('./runner/FileScanner.js');
const { generateTestRunner } = require('./runner/HtmlGenerator.js');
const { runTests } = require('./runner/BrowserRunner.js');
const { cleanupResources } = require('./runner/Cleanup.js');

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

// Main test runner
(async () => {
    log('🧪 Starting automated test runner...');
    log('='.repeat(60));

    let browser = null;

    try {
        // 1. Scan source files
        const baseDir = path.join(__dirname, '..');
        const srcDir = path.join(baseDir, 'src');

        // Build configuration (mirrors build/build.js logic)
        const PRIORITY = [
            'config/Config.js',
            'utils/Utils.js',
            'utils/Adapters.js',
            // Network modules
            'utils/network/UrlParser.js',
            'utils/network/AdDetection.js',
            'utils/network/MockGenerator.js',
            'utils/network/PatternDiscovery.js',
            // Player modules
            'utils/player/SignatureValidator.js',
            'utils/player/SessionManager.js',
            // Player Context modules
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
        const priorityFiles = PRIORITY.map(file => path.join(srcDir, file));
        const entryFile = path.join(srcDir, ENTRY);
        const sourceFiles = filterSourceFiles(allFiles, priorityFiles, entryFile, CONFIG.excludes);

        // 2. Generate HTML test runner
        await generateTestRunner(
            CONFIG.paths.template,
            CONFIG.paths.output,
            priorityFiles,
            sourceFiles,
            entryFile,
            __dirname,
            log
        );

        // 3. Run tests in browser
        const { browser: browserInstance, results } = await runTests(
            CONFIG.paths.output,
            CONFIG,
            logStream,
            log
        );
        browser = browserInstance;

        // 4. Report results
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

        await cleanupResources(browser, logStream, null, log);
        process.exit(results.failed > 0 ? 1 : 0);

    } catch (error) {
        await cleanupResources(browser, logStream, error, log);
        process.exit(1);
    }
})();
