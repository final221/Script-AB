import fs from 'fs';
import path from 'path';

// Define the source directory
const SRC_DIR = path.resolve(__dirname, '../src');

// Priority list from build.js
const PRIORITY = [
    'config/Config.js',
    'utils/Utils.js',
    'utils/Adapters.js',
    'network/PatternTester.js',
    'utils/network/UrlParser.js',
    'utils/network/AdDetection.js',
    'utils/network/MockGenerator.js',
    'utils/network/PatternDiscovery.js',
    'monitoring/AdAnalytics.js',
    'utils/player/SignatureValidator.js',
    'utils/player/SessionManager.js',
    'player/context/SignatureDetector.js',
    'player/context/ContextTraverser.js',
    'player/context/ContextValidator.js',
    'recovery/RecoveryConstants.js',
    'recovery/helpers/VideoSnapshotHelper.js',
    'recovery/helpers/RecoveryLock.js',
    'recovery/helpers/RecoveryValidator.js',
    'recovery/helpers/AVSyncRouter.js',
    'recovery/retry/PlayValidator.js',
    'recovery/retry/MicroSeekStrategy.js',
    'recovery/retry/PlayExecutor.js',
    'utils/_NetworkLogic.js',
    'utils/_PlayerLogic.js',
    'utils/Logic.js'
];

const ENTRY = 'core/CoreOrchestrator.js';

// Recursive file scanner
const getFiles = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            results = results.concat(getFiles(filePath));
        } else {
            results.push(filePath);
        }
    }
    return results;
};

// Force Mock MediaError
if (typeof MediaError === 'undefined') {
    global.MediaError = class MediaError {
        constructor() {
            this.code = 0;
            this.message = '';
        }
    };
    global.MediaError.MEDIA_ERR_ABORTED = 1;
    global.MediaError.MEDIA_ERR_NETWORK = 2;
    global.MediaError.MEDIA_ERR_DECODE = 3;
    global.MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
    window.MediaError = global.MediaError;
}

// Load all files
const loadSourceFiles = () => {
    const allFiles = getFiles(SRC_DIR);
    const normalize = p => path.normalize(p);
    const priorityFiles = PRIORITY.map(file => path.join(SRC_DIR, file));
    const entryFile = path.join(SRC_DIR, ENTRY);

    // Filter other files
    const otherFiles = allFiles.filter(file => {
        if (!file.endsWith('.js')) return false;
        const isPriority = priorityFiles.some(p => normalize(p) === normalize(file));
        if (isPriority) return false;
        const isEntry = normalize(file) === normalize(entryFile);
        if (isEntry) return false;
        return true;
    });

    // Combine in order
    const loadOrder = [...priorityFiles, ...otherFiles, entryFile];

    loadOrder.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            let exposedContent = content;
            let modified = false;

            // Transform 'const Module =' to 'var Module =' to expose to global scope via eval
            // We use 'var' because in non-strict eval it creates a global variable.
            // And we assign to window/global explicitly too.

            // Regex for IIFE modules: const Name = (() =>
            // Allow _Name and flexible whitespace
            exposedContent = exposedContent.replace(
                /^const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\(\s*\(\)\s*=>/gm,
                (match, name) => {
                    modified = true;
                    return `var ${name} = window.${name} = global.${name} = (() =>`;
                }
            );

            // Regex for object literals: const Name = {
            exposedContent = exposedContent.replace(
                /^const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\{/gm,
                (match, name) => {
                    modified = true;
                    return `var ${name} = window.${name} = global.${name} = {`;
                }
            );

            // Regex for functions: const Name = function
            exposedContent = exposedContent.replace(
                /^const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*function/gm,
                (match, name) => {
                    modified = true;
                    return `var ${name} = window.${name} = global.${name} = function`;
                }
            );

            if (!modified && file.includes('Logic.js')) {
                console.warn(`⚠️ Logic.js was NOT modified by regex! Content start: ${content.substring(0, 100)}`);
            }

            try {
                // Execute in global scope
                (0, eval)(exposedContent);
            } catch (e) {
                console.error(`Error loading ${path.relative(SRC_DIR, file)}:`, e);
            }
        }
    });
};

// Execute loading
loadSourceFiles();

// Mock window.exportTwitchAdLogs if needed
if (!window.exportTwitchAdLogs) {
    window.exportTwitchAdLogs = () => { };
}
