const fs = require('fs');
const path = require('path');

const { listJsFilesRecursive } = require('./file-utils');

const MODULE_RE = /^\s*\/\/\s*@module\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/m;
const DEPENDS_RE = /^\s*\/\/\s*@depends\s+(.+?)\s*$/m;
const HEADER_LINE_LIMIT = 30;

const toPosix = (filePath) => filePath.replace(/\\/g, '/');

const parseDepends = (raw) => {
    if (!raw || typeof raw !== 'string') return [];
    return raw
        .split(',')
        .map(token => token.trim())
        .filter(Boolean)
        .filter((token, index, arr) => arr.indexOf(token) === index);
};

const parseMetadataHeader = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const header = content.split(/\r?\n/).slice(0, HEADER_LINE_LIMIT).join('\n');
    const moduleMatch = header.match(MODULE_RE);
    const dependsMatch = header.match(DEPENDS_RE);
    return {
        moduleName: moduleMatch ? moduleMatch[1] : null,
        depends: parseDepends(dependsMatch ? dependsMatch[1] : '')
    };
};

const collectModuleMetadata = (srcDir) => {
    const files = listJsFilesRecursive(srcDir)
        .filter(filePath => filePath.endsWith('.js'))
        .sort((a, b) => a.localeCompare(b));

    const moduleToEntry = new Map();
    const pathToModule = new Map();
    const duplicates = [];
    const missingModule = [];

    files.forEach((filePath) => {
        const relPath = toPosix(path.relative(srcDir, filePath));
        const meta = parseMetadataHeader(filePath);
        if (!meta.moduleName) {
            missingModule.push(relPath);
            return;
        }

        const entry = {
            moduleName: meta.moduleName,
            depends: meta.depends,
            absPath: filePath,
            relPath
        };

        if (moduleToEntry.has(meta.moduleName)) {
            duplicates.push({
                moduleName: meta.moduleName,
                paths: [moduleToEntry.get(meta.moduleName).relPath, relPath]
            });
            return;
        }

        moduleToEntry.set(meta.moduleName, entry);
        pathToModule.set(relPath, meta.moduleName);
    });

    return {
        filesScanned: files.length,
        moduleToEntry,
        pathToModule,
        duplicates,
        missingModule
    };
};

const buildDependencyGraph = (moduleToEntry) => {
    const nodes = Array.from(moduleToEntry.keys());
    const adjacency = new Map(nodes.map(node => [node, new Set()]));
    const indegree = new Map(nodes.map(node => [node, 0]));
    const unresolvedDependencies = [];
    let edgeCount = 0;

    moduleToEntry.forEach((entry, moduleName) => {
        entry.depends.forEach((depName) => {
            if (!moduleToEntry.has(depName)) {
                unresolvedDependencies.push({
                    module: moduleName,
                    dependency: depName,
                    file: entry.relPath
                });
                return;
            }

            const outgoing = adjacency.get(depName);
            if (!outgoing.has(moduleName)) {
                outgoing.add(moduleName);
                indegree.set(moduleName, (indegree.get(moduleName) || 0) + 1);
                edgeCount += 1;
            }
        });
    });

    return {
        nodes,
        adjacency,
        indegree,
        unresolvedDependencies,
        edgeCount
    };
};

const topoSort = (graph, orderHint = new Map()) => {
    const indegree = new Map(graph.indegree);
    const queue = [];
    graph.nodes.forEach((node) => {
        if ((indegree.get(node) || 0) === 0) {
            queue.push(node);
        }
    });

    const getHint = (node) => (
        Number.isFinite(orderHint.get(node)) ? orderHint.get(node) : Number.MAX_SAFE_INTEGER
    );
    const sortQueue = () => {
        queue.sort((a, b) => {
            const hintDelta = getHint(a) - getHint(b);
            if (hintDelta !== 0) return hintDelta;
            return a.localeCompare(b);
        });
    };

    const ordered = [];
    while (queue.length > 0) {
        sortQueue();
        const node = queue.shift();
        ordered.push(node);
        const neighbors = Array.from(graph.adjacency.get(node) || []);
        neighbors.forEach((nextNode) => {
            const nextIn = (indegree.get(nextNode) || 0) - 1;
            indegree.set(nextNode, nextIn);
            if (nextIn === 0) {
                queue.push(nextNode);
            }
        });
    }

    if (ordered.length !== graph.nodes.length) {
        const cycleNodes = graph.nodes.filter(node => (indegree.get(node) || 0) > 0);
        return {
            ok: false,
            ordered,
            cycleNodes
        };
    }

    return {
        ok: true,
        ordered,
        cycleNodes: []
    };
};

const computeShadowReport = ({ srcDir, manifest }) => {
    const metadata = collectModuleMetadata(srcDir);
    const graph = buildDependencyGraph(metadata.moduleToEntry);
    const legacyPathOrder = [
        ...(Array.isArray(manifest.priority) ? manifest.priority : []),
        manifest.entry || 'core/orchestrators/CoreOrchestrator.js'
    ];
    const legacyModuleOrder = legacyPathOrder
        .map(relPath => metadata.pathToModule.get(relPath))
        .filter(Boolean);

    const orderHint = new Map();
    legacyModuleOrder.forEach((moduleName, index) => {
        if (!orderHint.has(moduleName)) {
            orderHint.set(moduleName, index);
        }
    });

    const topo = topoSort(graph, orderHint);
    const candidateModuleOrder = topo.ordered;
    const candidatePathOrder = candidateModuleOrder
        .map(moduleName => metadata.moduleToEntry.get(moduleName))
        .filter(Boolean)
        .map(entry => entry.relPath);
    const legacyAnnotatedPathOrder = legacyModuleOrder
        .map(moduleName => metadata.moduleToEntry.get(moduleName))
        .filter(Boolean)
        .map(entry => entry.relPath);

    const mismatchDetails = [];
    const maxLen = Math.max(candidatePathOrder.length, legacyAnnotatedPathOrder.length);
    for (let i = 0; i < maxLen; i += 1) {
        const legacyPath = legacyAnnotatedPathOrder[i] || null;
        const candidatePath = candidatePathOrder[i] || null;
        if (legacyPath !== candidatePath) {
            mismatchDetails.push({
                index: i,
                legacyPath,
                candidatePath
            });
        }
    }

    return {
        filesScanned: metadata.filesScanned,
        annotatedModules: metadata.moduleToEntry.size,
        duplicateModules: metadata.duplicates,
        missingModule: metadata.missingModule,
        unresolvedDependencies: graph.unresolvedDependencies,
        edgeCount: graph.edgeCount,
        topoOk: topo.ok,
        cycleNodes: topo.cycleNodes,
        legacyAnnotatedPathOrder,
        candidatePathOrder,
        orderMismatches: mismatchDetails
    };
};

module.exports = {
    parseMetadataHeader,
    collectModuleMetadata,
    buildDependencyGraph,
    topoSort,
    computeShadowReport
};
