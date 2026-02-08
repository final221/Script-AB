const fs = require('fs');
const path = require('path');

const { listFilesRecursive } = require('./file-utils');
const { collectModuleMetadata, buildDependencyGraph, topoSort } = require('./manifest-graph');

const DEFAULT_ENTRY = 'core/orchestrators/CoreOrchestrator.js';
const DEFAULT_MODE = 'graph';

const toPosix = (value) => value.replace(/\\/g, '/');
const normalizePath = (value) => path.normalize(value);

const readManifest = (manifestPath) => {
    const content = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(content);
};

const resolveMode = (explicitMode) => {
    const raw = explicitMode || process.env.MANIFEST_MODE || DEFAULT_MODE;
    const normalized = String(raw).trim().toLowerCase();
    if (normalized === DEFAULT_MODE) {
        return DEFAULT_MODE;
    }
    throw new Error(`[load-order] Unsupported MANIFEST_MODE="${normalized}". Only "${DEFAULT_MODE}" is supported.`);
};

const getManifestLoadOrder = ({ srcDir, resolvedManifest, allFiles }) => {
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

const getGraphLoadOrder = ({ srcDir, manifestOrder, allFiles }) => {
    const metadata = collectModuleMetadata(srcDir);
    const graph = buildDependencyGraph(metadata.moduleToEntry);
    const entryRelative = toPosix(path.relative(srcDir, manifestOrder.entryFile));
    const manifestRelative = manifestOrder.loadOrder.map(file => toPosix(path.relative(srcDir, file)));
    const files = allFiles || listFilesRecursive(srcDir);
    const allRelative = files
        .filter(file => file.endsWith('.js'))
        .map(file => toPosix(path.relative(srcDir, file)))
        .sort((a, b) => a.localeCompare(b));

    const orderHint = new Map();
    manifestRelative.forEach((relPath, index) => {
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

    const orderedAnnotated = topo.ordered
        .map(moduleName => metadata.moduleToEntry.get(moduleName))
        .filter(Boolean)
        .map(entry => entry.relPath)
        .filter(relPath => relPath !== entryRelative);
    const annotatedSet = new Set(orderedAnnotated);
    const unannotated = allRelative.filter(relPath => relPath !== entryRelative && !annotatedSet.has(relPath));
    const graphRelative = [...orderedAnnotated, ...unannotated, entryRelative];
    const priorityRelative = graphRelative.slice(0, graphRelative.length - 1);

    return {
        priorityFiles: priorityRelative.map(relPath => path.join(srcDir, relPath)),
        otherFiles: [],
        entryFile: path.join(srcDir, entryRelative),
        loadOrder: graphRelative.map(relPath => path.join(srcDir, relPath)),
        graphReport: {
            ...report,
            candidateAnnotatedCount: orderedAnnotated.length,
            unannotatedCount: unannotated.length
        }
    };
};

const getLoadOrder = ({ srcDir, manifestPath, manifest, allFiles, mode } = {}) => {
    if (!srcDir) {
        throw new Error('[load-order] srcDir is required');
    }
    if (!manifest && !manifestPath) {
        throw new Error('[load-order] manifestPath or manifest is required');
    }

    const resolvedMode = resolveMode(mode);
    const resolvedManifest = manifest || readManifest(manifestPath);
    const manifestOrder = getManifestLoadOrder({
        srcDir,
        resolvedManifest,
        allFiles
    });
    const graphOrder = getGraphLoadOrder({
        srcDir,
        manifestOrder,
        allFiles
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
