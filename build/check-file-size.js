const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const LIMIT = 250;

// Enforce immediately for all files, with bounded debt for current oversized files.
// Each exception is locked to a maximum line count and cannot grow.
const EXCEPTIONS_MAX_LINES = {
    'core/recovery/RecoveryManager.js': 386,
    'core/external/ExternalSignalHandlerAsset.js': 370,
    'core/candidate/CandidateSelector.js': 325,
    'core/recovery/RecoveryDecisionApplier.js': 294,
    'monitoring/Logger.js': 278
};

const listJsFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    entries.forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listJsFiles(fullPath));
            return;
        }
        if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    });
    return files;
};

const countLines = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).length;
};

const formatRel = (fullPath) => fullPath.replace(SRC + path.sep, '').replace(/\\/g, '/');

const main = () => {
    const files = listJsFiles(SRC);
    const violations = [];
    const debt = [];

    files.forEach((filePath) => {
        const rel = formatRel(filePath);
        const lines = countLines(filePath);
        if (lines <= LIMIT) return;

        const exceptionMax = EXCEPTIONS_MAX_LINES[rel];
        if (Number.isFinite(exceptionMax) && lines <= exceptionMax) {
            debt.push({ rel, lines, exceptionMax });
            return;
        }
        violations.push({
            rel,
            lines,
            reason: Number.isFinite(exceptionMax)
                ? `exception cap exceeded (${exceptionMax})`
                : `over limit (${LIMIT})`
        });
    });

    if (violations.length > 0) {
        console.error('[check-file-size] File size policy violation(s):');
        violations.forEach((item) => {
            console.error(`  - src/${item.rel}: ${item.lines} lines (${item.reason})`);
        });
        process.exit(1);
    }

    if (debt.length > 0) {
        console.log('[check-file-size] Oversized files under bounded debt caps:');
        debt.forEach((item) => {
            console.log(`  - src/${item.rel}: ${item.lines}/${item.exceptionMax}`);
        });
    } else {
        console.log('[check-file-size] OK (no oversized files).');
    }
};

main();
