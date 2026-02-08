const fs = require('fs');
const path = require('path');

const { listJsFilesRecursive } = require('./file-utils');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const POLICY = String(process.env.MODULE_METADATA_POLICY || 'warn').trim().toLowerCase();
const VALID_POLICIES = new Set(['warn', 'error', 'off']);

const MODULE_RE = /^\s*\/\/\s*@module\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/m;
const HEADER_LINE_LIMIT = 25;

const readHeader = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).slice(0, HEADER_LINE_LIMIT).join('\n');
};

const relSrcPath = (filePath) => filePath.replace(SRC + path.sep, '').replace(/\\/g, '/');

const main = () => {
    if (!VALID_POLICIES.has(POLICY)) {
        console.warn(`[check-manifest-metadata] Invalid MODULE_METADATA_POLICY="${POLICY}", using "warn".`);
    }
    const activePolicy = VALID_POLICIES.has(POLICY) ? POLICY : 'warn';
    if (activePolicy === 'off') {
        console.log('[check-manifest-metadata] Policy off; skipping check.');
        return;
    }

    const files = listJsFilesRecursive(SRC);
    const jsFiles = files.filter(filePath => filePath.endsWith('.js'));
    const missingModule = [];
    const moduleToFiles = new Map();

    jsFiles.forEach((filePath) => {
        const header = readHeader(filePath);
        const moduleMatch = header.match(MODULE_RE);
        if (!moduleMatch) {
            missingModule.push(relSrcPath(filePath));
            return;
        }
        const moduleName = moduleMatch[1];
        const current = moduleToFiles.get(moduleName) || [];
        current.push(relSrcPath(filePath));
        moduleToFiles.set(moduleName, current);
    });

    const duplicates = [];
    moduleToFiles.forEach((paths, moduleName) => {
        if (paths.length > 1) {
            duplicates.push({ moduleName, paths });
        }
    });

    const warningCount = missingModule.length + duplicates.length;
    const log = activePolicy === 'error' ? console.error : console.warn;

    console.log(`[check-manifest-metadata] Files scanned: ${jsFiles.length}`);
    console.log(`[check-manifest-metadata] Annotated modules: ${moduleToFiles.size}`);

    if (duplicates.length > 0) {
        log(`[check-manifest-metadata] Duplicate module names: ${duplicates.length}`);
        duplicates.forEach((item) => {
            log(`  - ${item.moduleName}: ${item.paths.join(', ')}`);
        });
    }

    if (missingModule.length > 0) {
        log(`[check-manifest-metadata] Files missing @module: ${missingModule.length}`);
    } else {
        console.log('[check-manifest-metadata] Files missing @module: 0');
    }

    if (activePolicy === 'error' && warningCount > 0) {
        console.error(`[check-manifest-metadata] Warning count: ${warningCount}`);
        process.exit(1);
        return;
    }

    if (activePolicy === 'warn' && warningCount > 0) {
        console.warn('[check-manifest-metadata] Policy=warn; continuing without failure.');
    }
    console.log(`[check-manifest-metadata] Warning count: ${warningCount}`);
};

main();
