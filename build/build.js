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

    // Order of files to concatenate (relative to BASE_DIR/src/)
    FILE_ORDER: [
        'config/Config.js',
        'utils/Utils.js',
        'utils/Adapters.js',
        'utils/Logic.js',
        'monitoring/Metrics.js',
        'monitoring/Instrumentation.js',
        'monitoring/ReportGenerator.js',
        'monitoring/Logger.js',
        'monitoring/Store.js',
        'network/AdBlocker.js',
        'network/Diagnostics.js',
        'network/Mocking.js',
        'network/NetworkManager.js',
        'player/PlayerContext.js',
        'health/StuckDetector.js',
        'health/FrameDropDetector.js',
        'health/AVSyncDetector.js',
        'health/HealthMonitor.js',
        'recovery/BufferAnalyzer.js',
        'recovery/PlayRetryHandler.js',
        'recovery/StandardRecovery.js',
        'recovery/AggressiveRecovery.js',
        'recovery/RecoveryStrategy.js',
        'recovery/ResilienceOrchestrator.js',
        'player/VideoListenerManager.js',
        'core/ScriptBlocker.js',
        'core/EventCoordinator.js',
        'core/PlayerLifecycle.js',
        'core/DOMObserver.js',
        'core/CoreOrchestrator.js'
    ]
};

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
    if (CONFIG.FILE_ORDER.includes(path.basename(CONFIG.OUT_FILE))) {
        console.error(`❌ Error: Output file "${path.basename(CONFIG.OUT_FILE)}" cannot be in the source list.`);
        return;
    }
    if (CONFIG.FILE_ORDER.includes(path.basename(__filename))) {
        console.error(`❌ Error: Build script "${path.basename(__filename)}" cannot be in the source list.`);
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

    // 5. Add Files in Order
    if (CONFIG.FILE_ORDER.length === 0) {
        console.warn('⚠️  No files specified in CONFIG.FILE_ORDER. Only header (if present) will be written.');
    }

    const srcDir = path.join(CONFIG.BASE_DIR, 'src');
    CONFIG.FILE_ORDER.forEach(fileName => {
        if (fileName.endsWith('.txt')) {
            console.log(`   - Skipping text file: ${fileName}`);
            return;
        }

        const filePath = path.join(srcDir, fileName);
        if (fs.existsSync(filePath)) {
            console.log(`   + Adding file: ${fileName}`);
            const content = fs.readFileSync(filePath, 'utf8');
            outputContent += content + '\n';
        } else {
            console.error(`❌ File not found: ${fileName} (Skipping)`);
        }
    });

    // 6. End IIFE
    outputContent += '})();\n';

    // 7. Write Output
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

