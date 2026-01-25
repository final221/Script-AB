const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

const toPosix = (filePath) => filePath.replace(/\\/g, '/');

const listJsFiles = (dir) => {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...listJsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            results.push(full);
        }
    }
    return results;
};

const buildSection = (baseDir, orderedFiles, seen, options = {}) => {
    const section = [];
    const baseAbs = path.join(SRC, baseDir);
    const orderedAbs = orderedFiles.map(file => path.join(baseAbs, file));
    const exclude = new Set(options.exclude || []);

    orderedAbs.forEach((filePath) => {
        if (!fs.existsSync(filePath)) {
            throw new Error(`[generate-manifest] Missing file: ${toPosix(path.relative(SRC, filePath))}`);
        }
        const rel = toPosix(path.relative(SRC, filePath));
        if (!seen.has(rel)) {
            seen.add(rel);
            section.push(rel);
        }
    });

    const allFiles = listJsFiles(baseAbs)
        .map(filePath => toPosix(path.relative(SRC, filePath)));
    const remainder = allFiles
        .filter(rel => !seen.has(rel))
        .filter(rel => !exclude.has(path.basename(rel)))
        .sort((a, b) => a.localeCompare(b));

    remainder.forEach((rel) => {
        if (!seen.has(rel)) {
            seen.add(rel);
            section.push(rel);
        }
    });

    return section;
};

const buildCoreSection = (subfolder, orderedFiles, seen, options) => (
    buildSection(path.join('core', subfolder), orderedFiles, seen, options)
);

const buildManifest = () => {
    const seen = new Set();
    const priority = [];

    priority.push(...buildSection('config', [
        'Config.js',
        'BuildInfo.js',
        'Tuning.js',
        'Validate.js'
    ], seen));

    priority.push(...buildSection('utils', [
        'Utils.js',
        'Adapters.js'
    ], seen));

    priority.push(...buildSection('recovery', [
        'BufferRanges.js',
        'HealPointFinder.js',
        'BufferGapFinder.js',
        'SeekTargetCalculator.js',
        'LiveEdgeSeeker.js'
    ], seen));

    priority.push(...buildSection('monitoring', [
        'ErrorClassifier.js',
        'LogTags.js',
        'LogTagRegistry.js',
        'LogSchemas.js',
        'LogSanitizer.js',
        'LogNormalizer.js',
        'Logger.js',
        'LogEvents.js',
        'TagCategorizer.js',
        'DetailFormatter.js',
        'LogFormatter.js',
        'LegendRenderer.js',
        'ReportTemplate.js',
        'ResourceWindow.js',
        'Metrics.js',
        'TimelineRenderer.js',
        'ReportGenerator.js',
        'ConsoleInterceptor.js',
        'ConsoleSignalDetector.js',
        'Instrumentation.js'
    ], seen));

    priority.push(...buildCoreSection('video', [
        'VideoState.js',
        'VideoStateSnapshot.js',
        'StateSnapshot.js',
        'MonitorRegistry.js',
        'MonitorCoordinator.js',
        'VideoDiscovery.js'
    ], seen));

    priority.push(...buildCoreSection('playback', [
        'PlaybackLogHelper.js',
        'PlaybackStateDefaults.js',
        'PlaybackMediaWatcher.js',
        'MediaState.js',
        'PlaybackStateStore.js',
        'PlaybackResetLogic.js',
        'PlaybackProgressReset.js',
        'PlaybackProgressLogic.js',
        'PlaybackSyncLogic.js',
        'PlaybackStarvationLogic.js',
        'PlaybackStateTracker.js',
        'PlaybackEventLogger.js',
        'PlaybackEventHandlersProgress.js',
        'PlaybackEventHandlersReady.js',
        'PlaybackEventHandlersStall.js',
        'PlaybackEventHandlersLifecycle.js',
        'PlaybackEventHandlers.js',
        'PlaybackWatchdog.js',
        'PlaybackMonitor.js'
    ], seen));

    priority.push(...buildCoreSection('candidate', [
        'CandidateScorer.js',
        'CandidateSwitchPolicy.js',
        'CandidateTrust.js',
        'CandidateScoreRecord.js',
        'CandidateProbation.js',
        'CandidateEvaluation.js',
        'CandidateSelectionLogger.js',
        'CandidateSelector.js'
    ], seen));

    priority.push(...buildCoreSection('recovery', [
        'RecoveryContext.js',
        'BackoffManager.js',
        'ProbationPolicy.js',
        'NoHealPointPolicy.js',
        'PlayErrorPolicy.js',
        'StallSkipPolicy.js',
        'RecoveryPolicyFactory.js',
        'RecoveryPolicy.js',
        'FailoverCandidatePicker.js',
        'FailoverProbeController.js',
        'FailoverManager.js',
        'RecoveryManager.js',
        'CatchUpController.js',
        'HealAttemptUtils.js',
        'HealAttemptLogger.js',
        'HealPointPoller.js',
        'HealPipeline.js',
        'AdGapSignals.js',
        'PlayheadAttribution.js'
    ], seen));

    priority.push(...buildCoreSection('external', [
        'ExternalSignalUtils.js',
        'ExternalSignalHandlerStall.js',
        'ExternalSignalHandlerAsset.js',
        'ExternalSignalHandlerAdblock.js',
        'ExternalSignalHandlerFallback.js',
        'ExternalSignalRouter.js'
    ], seen));

    priority.push(...buildCoreSection('orchestrators', [
        'MonitoringOrchestrator.js',
        'RecoveryOrchestrator.js',
        'StreamHealer.js'
    ], seen, { exclude: ['CoreOrchestrator.js'] }));

    return {
        priority,
        entry: 'core/orchestrators/CoreOrchestrator.js'
    };
};

const generateManifest = ({ check = false } = {}) => {
    const manifest = buildManifest();
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    const exists = fs.existsSync(MANIFEST_PATH);
    const current = exists ? fs.readFileSync(MANIFEST_PATH, 'utf8') : '';

    if (check) {
        if (!exists || current !== serialized) {
            return { ok: false, updated: false, manifest };
        }
        return { ok: true, updated: false, manifest };
    }

    if (!exists || current !== serialized) {
        fs.writeFileSync(MANIFEST_PATH, serialized);
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

module.exports = { generateManifest };
