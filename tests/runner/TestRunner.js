const path = require('path');
const { getFiles, filterSourceFiles } = require('./FileScanner.js');
const { generateTestRunner } = require('./HtmlGenerator.js');
const { runTests } = require('./BrowserRunner.js');
const { cleanupResources } = require('./Cleanup.js');

class TestRunner {
    constructor(config, reporter) {
        this.config = config;
        this.reporter = reporter;
        this.browser = null;
    }

    async run() {
        this.reporter.section('🧪 Starting automated test runner...');

        try {
            // 1. Scan source files
            const sourceFiles = await this._scanFiles();

            // 2. Generate HTML test runner
            await this._generateHtml(sourceFiles);

            // 3. Run tests in browser
            const results = await this._executeTests();

            // 4. Report results
            this._reportResults(results);

            await this._cleanup(null);
            return results.failed === 0;

        } catch (error) {
            await this._cleanup(error);
            throw error;
        }
    }

    async _scanFiles() {
        const baseDir = path.join(__dirname, '..', '..');
        const srcDir = path.join(baseDir, 'src');

        // Build configuration (mirrors build/build.js logic)
        // TODO: Externalize this priority list or share with build.js
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
            'recovery/helpers/RecoveryLock.js',
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

        return {
            priorityFiles,
            sourceFiles: filterSourceFiles(allFiles, priorityFiles, entryFile, this.config.excludes),
            entryFile
        };
    }

    async _generateHtml({ priorityFiles, sourceFiles, entryFile }) {
        await generateTestRunner(
            this.config.paths.template,
            this.config.paths.output,
            priorityFiles,
            sourceFiles,
            entryFile,
            path.join(__dirname, '..'), // tests dir
            this.reporter.log.bind(this.reporter)
        );
    }

    async _executeTests() {
        const { browser, results } = await runTests(
            this.config.paths.output,
            this.config,
            this.reporter.logStream,
            this.reporter.log.bind(this.reporter)
        );
        this.browser = browser;
        return results;
    }

    _reportResults(results) {
        this.reporter.log('');
        if (results.failed === 0) {
            this.reporter.success('✅ All tests passed!');
        } else {
            this.reporter.error(`❌ ${results.failed} test(s) failed`);
        }

        this.reporter.log('');
        this.reporter.log(`📄 Full log saved to: ${this.reporter.logStream.path}`);
    }

    async _cleanup(error) {
        await cleanupResources(
            this.browser,
            this.reporter.logStream,
            error,
            this.reporter.log.bind(this.reporter)
        );
    }
}

module.exports = { TestRunner };
