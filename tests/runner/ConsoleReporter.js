const { createWriteStream } = require('fs');

/**
 * Handles test output logging to console and file.
 */
class ConsoleReporter {
    constructor(logFilePath) {
        this.logStream = createWriteStream(logFilePath, { flags: 'w' });
    }

    /**
     * Logs a message to both console and file.
     * Strips ANSI codes for the file output.
     * @param {string} msg - The message to log.
     * @param {...any} args - Additional arguments for console.log.
     */
    log(msg, ...args) {
        console.log(msg, ...args);
        // Strip ANSI color codes for file
        const cleanMsg = String(msg).replace(/\x1b\[[0-9;]*m/g, '');
        this.logStream.write(cleanMsg + '\n');
    }

    /**
     * Logs a success message (green).
     * @param {string} msg 
     */
    success(msg) {
        this.log(`\x1b[32m${msg}\x1b[0m`);
    }

    /**
     * Logs an error message (red).
     * @param {string} msg 
     */
    error(msg) {
        this.log(`\x1b[31m${msg}\x1b[0m`);
    }

    /**
     * Logs a section header.
     * @param {string} title 
     */
    section(title) {
        this.log('');
        this.log('='.repeat(60));
        this.log(title);
        this.log('='.repeat(60));
    }

    /**
     * Closes the file stream.
     */
    close() {
        this.logStream.end();
    }
}

module.exports = { ConsoleReporter };
