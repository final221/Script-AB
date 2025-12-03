/**
 * Cleanup Module
 * Handles resource cleanup on test completion or failure.
 */

/**
 * Cleans up browser and log stream resources.
 * @param {Object} browser - Puppeteer browser instance
 * @param {Object} stream - Log file stream
 * @param {Error} error - Error object if test failed
 * @param {Function} log - Logging function
 * @returns {Promise<void>}
 */
const cleanupResources = async (browser, stream, error, log) => {
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

module.exports = {
    cleanupResources
};
