const fs = require('fs');
const path = require('path');

const { listFilesRecursive } = require('./file-utils');

const readManifest = (manifestPath) => {
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content);
};

const getLoadOrder = ({ srcDir, manifestPath, manifest, allFiles } = {}) => {
    if (!srcDir) {
        throw new Error('[load-order] srcDir is required');
    }

    const resolvedManifest = manifest || readManifest(manifestPath);
    const priority = Array.isArray(resolvedManifest.priority) ? resolvedManifest.priority : [];
    const entry = resolvedManifest.entry || 'core/orchestrators/CoreOrchestrator.js';
    const normalize = p => path.normalize(p);

    const priorityFiles = priority.map(file => path.join(srcDir, file));
    const entryFile = path.join(srcDir, entry);
    const files = allFiles || listFilesRecursive(srcDir);

    const otherFiles = files.filter(file => {
        if (!file.endsWith('.js')) return false;

        const isPriority = priorityFiles.some(p => normalize(p) === normalize(file));
        if (isPriority) return false;

        const isEntry = normalize(file) === normalize(entryFile);
        if (isEntry) return false;

        return true;
    });

    const loadOrder = [...priorityFiles, ...otherFiles, entryFile];

    return {
        manifest: resolvedManifest,
        priorityFiles,
        entryFile,
        otherFiles,
        loadOrder
    };
};

module.exports = { getLoadOrder };
