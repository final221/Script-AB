const fs = require('fs');
const path = require('path');

const listFilesRecursive = (dir) => {
    const results = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...listFilesRecursive(full));
        } else if (entry.isFile()) {
            results.push(full);
        }
    }
    return results;
};

const listJsFilesRecursive = (dir) => (
    listFilesRecursive(dir).filter(file => file.endsWith('.js'))
);

module.exports = {
    listFilesRecursive,
    listJsFilesRecursive
};
