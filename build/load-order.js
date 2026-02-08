const fs = require('fs');
const path = require('path');

const { listFilesRecursive } = require('./file-utils');
const { collectModuleMetadata, buildDependencyGraph, topoSort } = require('./manifest-graph');

const DEFAULT_ENTRY = 'core/orchestrators/CoreOrchestrator.js';
const DEFAULT_MODE = 'graph';
const LEGACY_MANIFEST_NAME = 'manifest.legacy.json';
const VALID_MODES = new Set(['legacy', 'graph']);

const toPosix = (value) => value.replace(/\\/g, '/');
const normalizePath = (value) => path.normalize(value);

const readManifest = (manifestPath) => {
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content);
};

const resolveLegacyManifestPath = (manifestPath, explicitLegacyManifestPath) => {
    if (explicitLegacyManifestPath) return explicitLegacyManifestPath;
    if (process.env.MANIFEST_LEGACY_PATH) return process.env.MANIFEST_LEGACY_PATH;
    const base = manifestPath ? path.dirname(manifestPath) : __dirname;
    return path.join(base, LEGACY_MANIFEST_NAME);
};

const getManifestMode = (explicitMode) => {
    const raw = explicitMode || process.env.MANIFEST_MODE || DEFAULT_MODE;
    const normalized = String(raw).trim().toLowerCase();
    if (VALID_MODES.has(normalized)) {
        return normalized;
    }
    return DEFAULT_MODE;
};

const getLegacyLoadOrder = ({ srcDir, resolvedManifest, allFiles }) => {
    const priority = Array.isArray(resolvedManifest.priority) ? resolvedManifest.priority : [];
    const entry = resolvedManifest.entry || DEFAULT_ENTRY;
    const priorityFiles = priority.map(file => path.join(srcDir, file));
    const entryFile = path.join(srcDir, entry);
    const files = allFiles || listFilesRecursive(srcDir);
    const jsFiles = files
        .filter(file => file.endsWith('.js'))
        .slice()
        .sort((a, b) => a.localeCompare(b));

    const otherFiles = jsFiles.filter(file => {
        const isPriority = priorityFiles.some(p => normalizePath(p) === normalizePath(file));
        if (isPriority) return false;

        const isEntry = normalizePath(file) === normalizePath(entryFile);
        if (isEntry) return false;

        return true;
    });

    const loadOrder = [...priorityFiles, ...otherFiles, entryFile];

    return {
        priority,
        entry,
        priorityFiles,
        entryFile,
        otherFiles,
        loadOrder
    };
};

const buildGraphError = (report) => {
    const issues = [];

    if (report.duplicateModules.length > 0) {
        const samples = report.duplicateModules
            .slice(0, 3)
            .map(item => `${item.moduleName} (${item.paths.join(', ')})`);
        issues.push(`Duplicate @module names: ${samples.join('; ')}`);
    }

    if (report.unresolvedDependencies.length > 0) {
        const samples = report.unresolvedDependencies
            .slice(0, 5)
            .map(item => `${item.module} -> ${item.dependency} (${item.file})`);
        issues.push(`Unresolved dependencies: ${samples.join('; ')}`);
    }

    if (!report.topoOk) {
        issues.push(`Dependency cycles: ${report.cycleNodes.join(', ')}`);
    }

    if (issues.length === 0) {
        return null;
    }

    return new Error(`[load-order] Graph manifest validation failed. ${issues.join(' | ')}`);
};

const getGraphLoadOrder = ({ srcDir, legacyOrder }) => {
    const metadata = collectModuleMetadata(srcDir);
    const graph = buildDependencyGraph(metadata.moduleToEntry);
    const entryRelative = toPosix(path.relative(srcDir, legacyOrder.entryFile));
    const legacyRelative = legacyOrder.loadOrder.map(file => toPosix(path.relative(srcDir, file)));
    const legacySet = new Set(legacyRelative);

    const orderHint = new Map();
    legacyRelative.forEach((relPath, index) => {
        const moduleName = metadata.pathToModule.get(relPath);
        if (!moduleName || moduleName === metadata.pathToModule.get(entryRelative)) return;
        if (!orderHint.has(moduleName)) {
            orderHint.set(moduleName, index);
        }
    });

    const topo = topoSort(graph, orderHint);
    const report = {
        duplicateModules: metadata.duplicates,
        unresolvedDependencies: graph.unresolvedDependencies,
        topoOk: topo.ok,
        cycleNodes: topo.cycleNodes
    };

    const graphError = buildGraphError(report);
    if (graphError) {
        throw graphError;
    }

    const candidateAnnotatedPaths = topo.ordered
        .map(moduleName => metadata.moduleToEntry.get(moduleName))
        .filter(Boolean)
        .map(entry => entry.relPath)
        .filter(relPath => relPath !== entryRelative && legacySet.has(relPath));

    let cursor = 0;
    const graphRelative = legacyRelative.map((relPath) => {
        if (relPath === entryRelative) {
            return relPath;
        }

        const moduleName = metadata.pathToModule.get(relPath);
        if (!moduleName) {
            return relPath;
        }

        const replacement = candidateAnnotatedPaths[cursor] || relPath;
        cursor += 1;
        return replacement;
    });

    const priorityCount = legacyOrder.priorityFiles.length;
    const priorityRelative = graphRelative.slice(0, priorityCount);
    const otherRelative = graphRelative.slice(priorityCount, graphRelative.length - 1);

    return {
        priorityFiles: priorityRelative.map(relPath => path.join(srcDir, relPath)),
        otherFiles: otherRelative.map(relPath => path.join(srcDir, relPath)),
        entryFile: path.join(srcDir, entryRelative),
        loadOrder: graphRelative.map(relPath => path.join(srcDir, relPath)),
        graphReport: {
            ...report,
            candidateAnnotatedCount: candidateAnnotatedPaths.length
        }
    };
};

const getLoadOrder = ({ srcDir, manifestPath, manifest, allFiles, mode, legacyManifestPath } = {}) => {
    if (!srcDir) {
        throw new Error('[load-order] srcDir is required');
    }

    const resolvedMode = getManifestMode(mode);
    const primaryManifest = manifest || readManifest(manifestPath);
    let resolvedManifest = primaryManifest;

    if (resolvedMode === 'legacy' && !manifest) {
        const fallbackPath = resolveLegacyManifestPath(manifestPath, legacyManifestPath);
        if (fs.existsSync(fallbackPath)) {
            resolvedManifest = readManifest(fallbackPath);
        }
    }

    const legacyOrder = getLegacyLoadOrder({
        srcDir,
        resolvedManifest,
        allFiles
    });

    if (resolvedMode === 'legacy') {
        return {
            mode: resolvedMode,
            manifest: resolvedManifest,
            priorityFiles: legacyOrder.priorityFiles,
            entryFile: legacyOrder.entryFile,
            otherFiles: legacyOrder.otherFiles,
            loadOrder: legacyOrder.loadOrder,
            graphReport: null
        };
    }

    const graphOrder = getGraphLoadOrder({
        srcDir,
        legacyOrder
    });

    return {
        mode: resolvedMode,
        manifest: resolvedManifest,
        priorityFiles: graphOrder.priorityFiles,
        entryFile: graphOrder.entryFile,
        otherFiles: graphOrder.otherFiles,
        loadOrder: graphOrder.loadOrder,
        graphReport: graphOrder.graphReport
    };
};

module.exports = { getLoadOrder };
