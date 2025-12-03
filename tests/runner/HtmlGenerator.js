const fs = require('fs').promises;
const path = require('path');

/**
 * HTML Generator Module
 * Generates test runner HTML with injected source files.
 */

/**
 * Generates the test runner HTML file dynamically.
 * @param {string} templatePath - Path to template file
 * @param {string} outputPath - Path to output file
 * @param {string[]} priorityFiles - Priority-ordered source files
 * @param {string[]} sourceFiles - Other source files
 * @param {string} entryFile - Entry point file
 * @param {string} testsDir - Tests directory for relative path calculation
 * @param {Function} log - Logging function
 * @returns {Promise<void>}
 */
const generateTestRunner = async (templatePath, outputPath, priorityFiles, sourceFiles, entryFile, testsDir, log) => {
    log('🔨 Generating test runner...');

    // Combine priority files, other files, and entry file last
    const finalFiles = [...priorityFiles, ...sourceFiles, entryFile];

    // Generate script tags
    const scriptTags = finalFiles.map(file => {
        // Create relative path from tests/ folder to src/ file
        const relativePath = path.relative(testsDir, file).replace(/\\/g, '/');
        return `    <script src="${relativePath}"></script>`;
    }).join('\n');

    // Read template and inject scripts
    let template = await fs.readFile(templatePath, 'utf8');
    const outputContent = template.replace('<!-- INJECT_SCRIPTS -->', scriptTags);

    await fs.writeFile(outputPath, outputContent);
    log(`✅ Generated ${outputPath} with ${finalFiles.length} source files`);
};

module.exports = {
    generateTestRunner
};
