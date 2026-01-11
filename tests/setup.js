import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the source directory
const SRC_DIR = path.resolve(__dirname, '../src');

// Priority list must match build.js order logic
const PRIORITY = [
    'config/Config.js',
    'utils/Utils.js',
    'utils/Adapters.js',
    'recovery/BufferGapFinder.js',
    'recovery/LiveEdgeSeeker.js',
    'monitoring/ErrorClassifier.js',
    'monitoring/Logger.js',
    'monitoring/Metrics.js',
    'monitoring/ReportGenerator.js',
    'monitoring/Instrumentation.js',
    'core/VideoState.js',
    'core/PlaybackMonitor.js',
    'core/StreamHealer.js',
];

const ENTRY = 'core/CoreOrchestrator.js';

// Recursive file scanner
const getFiles = (dir) => {
    let results = [];
    if (!fs.existsSync(dir)) return results;

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

// Global mocks for browser APIs if missing in JSDOM
if (!window.performance) {
    window.performance = { now: () => Date.now() };
}

// Ensure global Utils/Adapters namespace if accessed directly
window.Fn = window.Fn || {};

console.log('[Setup] Starting setup.js...');

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

            // Regex for IIFE modules: const Name = (() =>
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

            try {
                // Execute in global scope
                (0, eval)(exposedContent);
            } catch (e) {
                console.error(`[Setup] Error loading ${path.relative(SRC_DIR, file)}:`, e);
            }
        } else {
            console.warn(`[Setup] File not found: ${file}`);
        }
    });
};

// Execute loading
try {
    loadSourceFiles();
    console.log('[Setup] Source files loaded.');
} catch (e) {
    console.error('[Setup] CRITICAL ERROR loading source files:', e);
}

// Mock window.exportTwitchAdLogs if needed
if (!window.exportTwitchAdLogs) {
    window.exportTwitchAdLogs = () => { };
}
