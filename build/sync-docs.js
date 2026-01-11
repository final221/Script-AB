const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const DOC_PATH = path.join(ROOT, 'docs', 'ARCHITECTURE.md');
const START = '<!-- LOAD_ORDER_START -->';
const END = '<!-- LOAD_ORDER_END -->';

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const ordered = [
    ...(Array.isArray(manifest.priority) ? manifest.priority : []),
    manifest.entry || 'core/CoreOrchestrator.js'
];

const docBuffer = fs.readFileSync(DOC_PATH);
const newline = docBuffer.includes(Buffer.from('\r\n', 'ascii')) ? '\r\n' : '\n';
const list = ordered
    .map((file, index) => `${index + 1}. \`${file}\``)
    .join(newline);

const expectedBlock = `${START}${newline}${list}${newline}${END}`;
const startBuffer = Buffer.from(START, 'ascii');
const endBuffer = Buffer.from(END, 'ascii');
const startIndex = docBuffer.indexOf(startBuffer);
const endIndex = docBuffer.indexOf(endBuffer);

if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    console.error('[sync-docs] Load order markers not found in docs/ARCHITECTURE.md');
    process.exit(1);
}

const updatedBuffer = Buffer.concat([
    docBuffer.slice(0, startIndex),
    Buffer.from(expectedBlock, 'ascii'),
    docBuffer.slice(endIndex + endBuffer.length)
]);
const isCheck = process.argv.includes('--check');

if (isCheck) {
    if (!docBuffer.equals(updatedBuffer)) {
        console.error('[sync-docs] docs/ARCHITECTURE.md is out of sync with build/manifest.json');
        process.exit(1);
    }
    process.exit(0);
}

if (!docBuffer.equals(updatedBuffer)) {
    fs.writeFileSync(DOC_PATH, updatedBuffer);
    console.log('[sync-docs] Updated docs/ARCHITECTURE.md module load order');
}
