import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the source directory
const SRC_DIR = path.resolve(__dirname, '../src');

const MANIFEST_PATH = path.resolve(__dirname, '../build/manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const PRIORITY = Array.isArray(manifest.priority) ? manifest.priority : [];
const ENTRY = manifest.entry || 'core/orchestrators/CoreOrchestrator.js';

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

    const topLevelDecl = /^(?:const|let|var|function|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/gm;

    loadOrder.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');
            const names = new Set();
            let match;

            topLevelDecl.lastIndex = 0;
            while ((match = topLevelDecl.exec(content)) !== null) {
                names.add(match[1]);
            }

            let exposedContent = content;
            if (names.size > 0) {
                const lines = Array.from(names).map(
                    name => `window.${name} = global.${name} = ${name};`
                );
                exposedContent = `${content}\n\n// Expose top-level declarations for tests\n${lines.join('\n')}\n`;
            }

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
