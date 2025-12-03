const path = require('path');
const CONFIG = require('./test.config.js');
const { ConsoleReporter } = require('./runner/ConsoleReporter.js');
const { TestRunner } = require('./runner/TestRunner.js');

(async () => {
    const logFile = path.join(__dirname, 'last-run.log');
    const reporter = new ConsoleReporter(logFile);
    const runner = new TestRunner(CONFIG, reporter);

    try {
        const success = await runner.run();
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('Critical error:', error);
        process.exit(1);
    }
})();
