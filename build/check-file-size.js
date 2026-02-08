const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DEFAULT_LIMIT = 250;
const parseLimit = () => {
    const raw = process.env.FILE_SIZE_LIMIT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
};
const LIMIT = parseLimit();
const POLICY = String(process.env.FILE_SIZE_POLICY || 'warn').trim().toLowerCase();
const VALID_POLICIES = new Set(['warn', 'error', 'off']);

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
    if (!VALID_POLICIES.has(POLICY)) {
        console.warn(`[check-file-size] Invalid FILE_SIZE_POLICY="${POLICY}", using "warn".`);
    }
    const activePolicy = VALID_POLICIES.has(POLICY) ? POLICY : 'warn';
    if (activePolicy === 'off') {
        console.log('[check-file-size] Policy off; skipping check.');
        return;
    }

    const files = listJsFiles(SRC);
    const violations = [];

    files.forEach((filePath) => {
        const rel = formatRel(filePath);
        const lines = countLines(filePath);
        if (lines <= LIMIT) return;
        violations.push({
            rel,
            lines,
            reason: `over limit (${LIMIT})`
        });
    });

    if (violations.length === 0) {
        console.log(`[check-file-size] OK (all src/*.js files <= ${LIMIT} lines).`);
        console.log('[check-file-size] Warning count: 0');
        return;
    }

    const log = activePolicy === 'error' ? console.error : console.warn;
    log(`[check-file-size] ${violations.length} file(s) exceed ${LIMIT} lines:`);
    violations.forEach((item) => {
        log(`  - src/${item.rel}: ${item.lines} lines (${item.reason})`);
    });

    if (activePolicy === 'error') {
        console.error(`[check-file-size] Warning count: ${violations.length}`);
        process.exit(1);
        return;
    }

    console.warn('[check-file-size] Policy=warn; continuing without failure.');
    console.warn(`[check-file-size] Warning count: ${violations.length}`);
};

main();
