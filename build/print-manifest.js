const path = require('path');
const { generateManifest } = require('./generate-manifest');

const ROOT = path.join(__dirname, '..');
const result = generateManifest({ check: false });
const manifest = result.manifest;

console.log('Manifest entry:', manifest.entry);
console.log('Priority order:');
manifest.priority.forEach((file, index) => {
    console.log(`${index + 1}. ${file}`);
});
