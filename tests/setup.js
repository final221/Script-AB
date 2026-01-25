import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
import loadOrderModule from '../build/load-order.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the source directory
const SRC_DIR = path.resolve(__dirname, '../src');

const MANIFEST_PATH = path.resolve(__dirname, '../build/manifest.json');
const { getLoadOrder } = loadOrderModule;
const { loadOrder } = getLoadOrder({ srcDir: SRC_DIR, manifestPath: MANIFEST_PATH });

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
