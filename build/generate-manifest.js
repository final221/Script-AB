const fs = require('fs');
const path = require('path');

const { listJsFilesRecursive } = require('./file-utils');
const { collectModuleMetadata, buildDependencyGraph, topoSort } = require('./manifest-graph');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const DEFAULT_ENTRY = 'core/orchestrators/CoreOrchestrator.js';

const toPosix = (filePath) => filePath.replace(/\\/g, '/');
const byLex = (a, b) => a.localeCompare(b);

const buildOrderHint = ({ pathToModule, allJsFiles }) => {
    const hint = new Map();
    let cursor = 0;

    allJsFiles.forEach((relPath) => {
        const moduleName = pathToModule.get(relPath);
        if (!moduleName || hint.has(moduleName)) return;
        hint.set(moduleName, cursor);
        cursor += 1;
    });

    return hint;
};

const buildGraphIssues = ({ duplicates, unresolvedDependencies, topo }) => {
    const issues = [];
    if (duplicates.length > 0) {
        issues.push(`duplicate_modules:${duplicates.length}`);
    }
    if (unresolvedDependencies.length > 0) {
        issues.push(`unresolved_dependencies:${unresolvedDependencies.length}`);
    }
    if (!topo.ok) {
        issues.push(`cycles:${topo.cycleNodes.length}`);
    }
    return issues;
};

const buildManifest = ({ srcDir = SRC, entry = DEFAULT_ENTRY } = {}) => {
    const allJsFiles = listJsFilesRecursive(srcDir)
        .map(filePath => toPosix(path.relative(srcDir, filePath)))
        .sort(byLex);

    if (!allJsFiles.includes(entry)) {
        throw new Error(`[generate-manifest] Missing entry file: ${entry}`);
    }

    const metadata = collectModuleMetadata(srcDir);
    const graph = buildDependencyGraph(metadata.moduleToEntry);
    const hint = buildOrderHint({
        pathToModule: metadata.pathToModule,
        allJsFiles
    });
    const topo = topoSort(graph, hint);
    const issues = buildGraphIssues({
        duplicates: metadata.duplicates,
        unresolvedDependencies: graph.unresolvedDependencies,
        topo
    });

    if (issues.length > 0) {
        throw new Error(`[generate-manifest] Invalid graph metadata (${issues.join(', ')})`);
    }

    const moduleOrdered = topo.ordered
        .map(moduleName => metadata.moduleToEntry.get(moduleName))
        .filter(Boolean)
        .map(entryMeta => entryMeta.relPath);
    const moduleSet = new Set(moduleOrdered);
    const missingMetadata = allJsFiles.filter(relPath => !moduleSet.has(relPath));
    const orderedWithoutEntry = moduleOrdered.filter(relPath => relPath !== entry);
    const metadataMissingWithoutEntry = missingMetadata.filter(relPath => relPath !== entry);

    return {
        priority: [...orderedWithoutEntry, ...metadataMissingWithoutEntry],
        entry
    };
};

const generateManifest = ({
    check = false,
    srcDir = SRC,
    manifestPath = MANIFEST_PATH,
    entry = DEFAULT_ENTRY
} = {}) => {
    const manifest = buildManifest({
        srcDir,
        entry
    });
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    const exists = fs.existsSync(manifestPath);
    const current = exists ? fs.readFileSync(manifestPath, 'utf8') : '';

    if (check) {
        if (!exists || current !== serialized) {
            return { ok: false, updated: false, manifest };
        }
        return { ok: true, updated: false, manifest };
    }

    if (!exists || current !== serialized) {
        fs.writeFileSync(manifestPath, serialized);
        return { ok: true, updated: true, manifest };
    }
    return { ok: true, updated: false, manifest };
};

if (require.main === module) {
    const isCheck = process.argv.includes('--check');
    const result = generateManifest({ check: isCheck });
    if (isCheck && !result.ok) {
        console.error('[generate-manifest] build/manifest.json is out of sync');
        process.exit(1);
    }
    if (result.updated) {
        console.log('[generate-manifest] Updated build/manifest.json');
    }
}

module.exports = { generateManifest, buildManifest };
