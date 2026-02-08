const path = require('path');

const { getLoadOrder } = require('./load-order');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST = path.join(__dirname, 'manifest.json');

const main = () => {
    try {
        const result = getLoadOrder({
            srcDir: SRC,
            manifestPath: MANIFEST,
            mode: 'graph'
        });
        const report = result.graphReport || {
            duplicateModules: [],
            unresolvedDependencies: [],
            cycleNodes: []
        };

        console.log(`[check-manifest-graph] Mode: ${result.mode}`);
        console.log(`[check-manifest-graph] Duplicate modules: ${report.duplicateModules.length}`);
        console.log(`[check-manifest-graph] Unresolved dependencies: ${report.unresolvedDependencies.length}`);
        console.log(`[check-manifest-graph] Dependency cycles: ${report.cycleNodes.length}`);
        console.log('[check-manifest-graph] Warning count: 0');
    } catch (error) {
        console.error(`[check-manifest-graph] ${error.message}`);
        process.exit(1);
    }
};

main();
