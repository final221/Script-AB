const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    // Base directory (parent of build/)
    BASE_DIR: path.join(__dirname, '..'),

    // Output file path
    OUT_FILE: path.join(__dirname, '..', 'dist', 'code.js'),

    // Header file (contains UserScript metadata)
    HEADER_FILE: path.join(__dirname, 'header.js'),

    // Files that must be loaded first (Dependencies)
    PRIORITY_FILES: [
        'config/Config.js',
        'utils/Utils.js',
        'utils/Adapters.js',
        'utils/Logic.js'
    ],

    // The entry point (Must be last)
    ENTRY_FILE: 'core/CoreOrchestrator.js'
};

// --- Helpers ---

function getFilesRecursively(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getFilesRecursively(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    });
    return fileList;
}

// --- Version Management ---

function readVersion() {
    const versionPath = path.join(__dirname, 'version.txt');
    try {
        return fs.readFileSync(versionPath, 'utf8').trim();
    } catch (err) {
        console.warn('⚠️  version.txt not found, using 1.0.0');
        return '1.0.0';
    }
}

function writeVersion(version) {
    const versionPath = path.join(__dirname, 'version.txt');
    fs.writeFileSync(versionPath, version);
}

function incrementVersion(version, type = 'patch') {
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

    return parts.join('.');
}

// --- Build Logic ---

function build() {
    console.log('🏗️  Starting build...');

    // 1. Version Management
    const args = process.argv.slice(2);
    let versionType = 'patch';

    if (args.includes('--major')) {
        versionType = 'major';
    } else if (args.includes('--minor')) {
        versionType = 'minor';
    }

    const currentVersion = readVersion();
    const newVersion = incrementVersion(currentVersion, versionType);
    writeVersion(newVersion);

    console.log(`📦 Version: ${currentVersion} → ${newVersion} (${versionType})`);

    // 2. Validation
    if (path.basename(CONFIG.OUT_FILE) === path.basename(__filename)) {
        console.error(`❌ Error: Output file cannot be the build script.`);
        return;
    }

    let outputContent = '';

    // 3. Add Header (if it exists)
    if (fs.existsSync(CONFIG.HEADER_FILE)) {
        console.log(`   + Adding header: header.js`);
        let headerContent = fs.readFileSync(CONFIG.HEADER_FILE, 'utf8');
        // Replace version placeholder
        headerContent = headerContent.replace('{{VERSION}}', newVersion);
        outputContent += headerContent + '\n';
    } else {
        console.warn(`⚠️  Header file not found: header.js`);
    }

    // 4. Start IIFE
    outputContent += '(function () {\n    \'use strict\';\n\n';

    // 5. Collect Files
    const srcDir = path.join(CONFIG.BASE_DIR, 'src');
    const allFiles = getFilesRecursively(srcDir);

    // Normalize paths for comparison (Windows/Unix)
    const normalize = p => p.split(path.sep).join('/');

    const priorityFiles = CONFIG.PRIORITY_FILES.map(f => path.join(srcDir, f));
    const entryFile = path.join(srcDir, CONFIG.ENTRY_FILE);

    // Filter out priority and entry files from the general list
    const otherFiles = allFiles.filter(f => {
        // Check if it's a JS file
        if (!f.endsWith('.js')) return false;

        // Check if it's in priority list (compare normalized paths)
        const isPriority = priorityFiles.some(pf => path.normalize(pf) === path.normalize(f));
        const isEntry = path.normalize(f) === path.normalize(entryFile);

        return !isPriority && !isEntry;
    });

    // Construct final list: Priority -> Others -> Entry
    const finalOrder = [...priorityFiles, ...otherFiles, entryFile];

    // 6. Concatenate
    finalOrder.forEach(filePath => {
        const relativeName = path.relative(srcDir, filePath);

        if (fs.existsSync(filePath)) {
            console.log(`   + Adding file: ${relativeName}`);
            const content = fs.readFileSync(filePath, 'utf8');
            outputContent += content + '\n';
        } else {
            console.error(`❌ File not found: ${relativeName} (Skipping)`);
        }
    });

    // 7. End IIFE
    outputContent += '})();\n';

    // 8. Write Output
    try {
        fs.writeFileSync(CONFIG.OUT_FILE, outputContent);
        console.log(`✅ Build successful! Output written to: ${CONFIG.OUT_FILE}`);
        console.log(`   Total size: ${(outputContent.length / 1024).toFixed(2)} KB`);
    } catch (err) {
        console.error(`❌ Error writing output file: ${err.message}`);
    }
}

// Run build
build();

