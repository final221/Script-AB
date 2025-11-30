const fs = require('fs');
const path = require('path');

const CONFIG = {
    BASE: path.join(__dirname, '..'),
    OUT: path.join(__dirname, '..', 'dist', 'code.js'),
    HEADER: path.join(__dirname, 'header.js'),
    VERSION: path.join(__dirname, 'version.txt'),
    PRIORITY: ['config/Config.js', 'utils/Utils.js', 'utils/Adapters.js', 'utils/Logic.js'],
    ENTRY: 'core/CoreOrchestrator.js'
};

/**
 * Recursively gets all files in a directory.
 * @param {string} dir - The directory to search.
 * @returns {string[]} List of absolute file paths.
 */
const getFiles = (dir) => fs.readdirSync(dir).reduce((acc, file) => {
    const filePath = path.join(dir, file);
    return acc.concat(fs.statSync(filePath).isDirectory() ? getFiles(filePath) : filePath);
}, []);

/**
 * Updates the semantic version in the version file.
 * @param {'major'|'minor'|'patch'} type - The type of version bump.
 * @returns {{old: string, new: string}} The old and new versions.
 */
const updateVersion = (type = 'patch') => {
    let version = '1.0.0';
    try {
        version = fs.readFileSync(CONFIG.VERSION, 'utf8').trim();
    } catch (e) {
        // Version file might not exist yet, defaulting to 1.0.0
    }

    const parts = version.split('.').map(Number);

    if (type === 'major') {
        parts[0]++;
        parts[1] = 0;
        parts[2] = 0;
    } else if (type === 'minor') {
        parts[1]++;
        parts[2] = 0;
    } else {
        parts[2]++;
    }

    const newVersion = parts.join('.');
    fs.writeFileSync(CONFIG.VERSION, newVersion);
    return { old: version, new: newVersion };
};

(() => {
    console.log('🏗️  Building...');

    const args = process.argv.slice(2);
    const versionType = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch';

    const { old, new: version } = updateVersion(versionType);
    console.log(`📦 Version: ${old} → ${version} (${versionType})`);

    if (path.basename(CONFIG.OUT) === path.basename(__filename)) {
        return console.error('❌ Output cannot be build script');
    }

    const srcDir = path.join(CONFIG.BASE, 'src');
    const allFiles = getFiles(srcDir);
    const normalize = p => path.normalize(p);

    const priorityFiles = CONFIG.PRIORITY.map(file => path.join(srcDir, file));
    const entryFile = path.join(srcDir, CONFIG.ENTRY);

    // Filter out non-js files, priority files, and the entry file
    const otherFiles = allFiles.filter(file =>
        file.endsWith('.js') &&
        !priorityFiles.some(p => normalize(p) === normalize(file)) &&
        normalize(file) !== normalize(entryFile)
    );

    const headerContent = fs.existsSync(CONFIG.HEADER)
        ? fs.readFileSync(CONFIG.HEADER, 'utf8').replace('{{VERSION}}', version) + '\n'
        : '';

    const combinedContent = [...priorityFiles, ...otherFiles, entryFile].map(file => {
        console.log(`   + ${path.relative(srcDir, file)}`);
        return fs.readFileSync(file, 'utf8');
    }).join('\n');

    try {
        const finalOutput = `${headerContent}(function () {\n    'use strict';\n\n${combinedContent}\n})();\n`;
        fs.writeFileSync(CONFIG.OUT, finalOutput);
        console.log(`✅ Built: ${CONFIG.OUT} (${(combinedContent.length / 1024).toFixed(2)} KB)`);
    } catch (e) {
        console.error(`❌ Error: ${e.message}`);
    }
})();
