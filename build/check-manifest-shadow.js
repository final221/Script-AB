const fs = require('fs');
const path = require('path');

const { computeShadowReport } = require('./manifest-graph');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const POLICY = String(process.env.MANIFEST_SHADOW_POLICY || 'warn').trim().toLowerCase();
const VALID_POLICIES = new Set(['warn', 'error', 'off']);
const MISMATCH_SAMPLE_MAX = 10;

const main = () => {
    if (!VALID_POLICIES.has(POLICY)) {
        console.warn(`[check-manifest-shadow] Invalid MANIFEST_SHADOW_POLICY="${POLICY}", using "warn".`);
    }
    const activePolicy = VALID_POLICIES.has(POLICY) ? POLICY : 'warn';
    if (activePolicy === 'off') {
        console.log('[check-manifest-shadow] Policy off; skipping check.');
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const report = computeShadowReport({
        srcDir: SRC,
        manifest
    });

    console.log(`[check-manifest-shadow] Files scanned: ${report.filesScanned}`);
    console.log(`[check-manifest-shadow] Annotated modules: ${report.annotatedModules}`);
    console.log(`[check-manifest-shadow] Graph edges: ${report.edgeCount}`);
    console.log(`[check-manifest-shadow] Candidate order size: ${report.candidatePathOrder.length}`);
    console.log(`[check-manifest-shadow] Legacy annotated order size: ${report.legacyAnnotatedPathOrder.length}`);

    const issues = [];
    if (report.duplicateModules.length > 0) {
        issues.push(`duplicate_modules:${report.duplicateModules.length}`);
        console.warn(`[check-manifest-shadow] Duplicate modules: ${report.duplicateModules.length}`);
    }
    if (report.unresolvedDependencies.length > 0) {
        issues.push(`unresolved_dependencies:${report.unresolvedDependencies.length}`);
        console.warn(`[check-manifest-shadow] Unresolved dependencies: ${report.unresolvedDependencies.length}`);
    } else {
        console.log('[check-manifest-shadow] Unresolved dependencies: 0');
    }
    if (!report.topoOk) {
        issues.push(`cycles:${report.cycleNodes.length}`);
        console.warn(`[check-manifest-shadow] Dependency cycles detected: ${report.cycleNodes.join(', ')}`);
    } else {
        console.log('[check-manifest-shadow] Dependency cycles: 0');
    }
    if (report.orderMismatches.length > 0) {
        issues.push(`order_mismatches:${report.orderMismatches.length}`);
        console.warn(`[check-manifest-shadow] Candidate vs legacy mismatches: ${report.orderMismatches.length}`);
        report.orderMismatches.slice(0, MISMATCH_SAMPLE_MAX).forEach((item) => {
            console.warn(
                `  - [${item.index}] legacy=${item.legacyPath || 'null'} candidate=${item.candidatePath || 'null'}`
            );
        });
    } else {
        console.log('[check-manifest-shadow] Candidate vs legacy mismatches: 0');
    }

    const warningCount = issues.length;
    if (activePolicy === 'error' && warningCount > 0) {
        console.error(`[check-manifest-shadow] Warning count: ${warningCount}`);
        process.exit(1);
        return;
    }
    if (activePolicy === 'warn' && warningCount > 0) {
        console.warn('[check-manifest-shadow] Policy=warn; continuing without failure.');
    }
    console.log(`[check-manifest-shadow] Warning count: ${warningCount}`);
};

main();
