const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    // Directory containing your source files
    SRC_DIR: __dirname,

    // Output file path
    OUT_FILE: path.join(__dirname, 'code.js'),

    // Header file (contains UserScript metadata)
    HEADER_FILE: 'header.js',

    // Order of files to concatenate (excluding header)
    // Add your file names here in the order they should appear
    FILE_ORDER: [
        'Config.js',
        'Utils.js',
        'Adapters.js',
        'Logic.js',
        'Metrics.js',
        'Instrumentation.js',
        'ReportGenerator.js',
        'Logger.js',
        'Store.js',
        'AdBlocker.js',
        'Diagnostics.js',
        'Mocking.js',
        'NetworkManager.js',
        'PlayerContext.js',
        'StuckDetector.js',
        'FrameDropDetector.js',
        'AVSyncDetector.js',
        'HealthMonitor.js',
        'Resilience.js',
        'VideoListenerManager.js',
        'ScriptBlocker.js',
        'EventCoordinator.js',
        'PlayerLifecycle.js',
        'DOMObserver.js',
        'CoreOrchestrator.js'
    ]
};

// --- Build Logic ---

function build() {
    console.log('🏗️  Starting build...');

    // 1. Validation
    if (CONFIG.FILE_ORDER.includes(path.basename(CONFIG.OUT_FILE))) {
        console.error(`❌ Error: Output file "${path.basename(CONFIG.OUT_FILE)}" cannot be in the source list.`);
        return;
    }
    if (CONFIG.FILE_ORDER.includes(path.basename(__filename))) {
        console.error(`❌ Error: Build script "${path.basename(__filename)}" cannot be in the source list.`);
        return;
    }

    let outputContent = '';

    // 2. Add Header (if it exists)
    const headerPath = path.join(CONFIG.SRC_DIR, CONFIG.HEADER_FILE);
    if (fs.existsSync(headerPath)) {
        console.log(`   + Adding header: ${CONFIG.HEADER_FILE}`);
        outputContent += fs.readFileSync(headerPath, 'utf8') + '\n';
    } else {
        console.warn(`⚠️  Header file not found: ${CONFIG.HEADER_FILE}`);
    }

    // 3. Start IIFE
    outputContent += '(function () {\n    \'use strict\';\n\n';

    // 4. Add Files in Order
    if (CONFIG.FILE_ORDER.length === 0) {
        console.warn('⚠️  No files specified in CONFIG.FILE_ORDER. Only header (if present) will be written.');
    }

    CONFIG.FILE_ORDER.forEach(fileName => {
        if (fileName.endsWith('.txt')) {
            console.log(`   - Skipping text file: ${fileName}`);
            return;
        }

        const filePath = path.join(CONFIG.SRC_DIR, fileName);
        if (fs.existsSync(filePath)) {
            console.log(`   + Adding file: ${fileName}`);
            const content = fs.readFileSync(filePath, 'utf8');
            outputContent += content + '\n';
        } else {
            console.error(`❌ File not found: ${fileName} (Skipping)`);
        }
    });

    // 5. End IIFE
    outputContent += '})();\n';

    // 6. Write Output
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
