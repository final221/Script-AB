const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_ROOT = path.join(ROOT, 'blueprint', 'template');

const BUILD_FILES_TO_COPY = [
    'agent-commit.js',
    'agent-verify.js',
    'build.js',
    'check-file-size.js',
    'check-manifest-graph.js',
    'check-manifest-metadata.js',
    'file-utils.js',
    'generate-manifest.js',
    'load-order.js',
    'manifest-graph.js',
    'print-manifest.js',
    'sync-docs.js'
];

const usage = () => {
    console.log([
        'Usage:',
        '  node build/scaffold-blueprint.js --target <path> [options]',
        '',
        'Options:',
        '  --target <path>          Required. Destination directory for the new repo.',
        '  --name <npm-name>        Optional. package.json name (default: folder name).',
        '  --title <project title>  Optional. Human-readable project title.',
        '  --description <text>     Optional. Project description.',
        '  --force                  Optional. Allow writing into a non-empty target.',
        '  --skip-init              Optional. Skip manifest/doc initialization step.',
        '  --help                   Show this help message.'
    ].join('\n'));
};

const toPackageName = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || 'project-blueprint';
};

const parseArgs = () => {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        usage();
        process.exit(0);
    }

    const readArg = (flag) => {
        const index = args.indexOf(flag);
        if (index === -1) return null;
        const value = args[index + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${flag}`);
        }
        return value;
    };

    const target = readArg('--target');
    if (!target) {
        throw new Error('Missing required --target');
    }

    const targetAbs = path.resolve(process.cwd(), target);
    const targetBase = path.basename(targetAbs);
    const name = toPackageName(readArg('--name') || targetBase);
    const title = (readArg('--title') || targetBase || 'Project Blueprint').trim();
    const description = (readArg('--description')
        || 'Project scaffolded from the Twitch Stream Healer blueprint.').trim();

    return {
        targetAbs,
        name,
        title,
        description,
        force: args.includes('--force'),
        skipInit: args.includes('--skip-init')
    };
};

const ensureWritableTarget = ({ targetAbs, force }) => {
    if (!fs.existsSync(targetAbs)) {
        fs.mkdirSync(targetAbs, { recursive: true });
        return;
    }

    const existing = fs.readdirSync(targetAbs);
    if (existing.length === 0) return;
    if (force) return;

    throw new Error(`Target is not empty: ${targetAbs}. Use --force to overwrite.`);
};

const ensureDirForFile = (filePath) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const renderTemplate = (content, tokens) => (
    content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => (
        Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : `{{${key}}}`
    ))
);

const copyTemplateTree = ({ sourceDir, targetDir, tokens }) => {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(targetPath, { recursive: true });
            copyTemplateTree({ sourceDir: sourcePath, targetDir: targetPath, tokens });
            return;
        }
        if (!entry.isFile()) return;
        const raw = fs.readFileSync(sourcePath, 'utf8');
        const rendered = renderTemplate(raw, tokens);
        ensureDirForFile(targetPath);
        fs.writeFileSync(targetPath, rendered);
    });
};

const copyBuildScripts = (targetAbs) => {
    const buildDir = path.join(targetAbs, 'build');
    fs.mkdirSync(buildDir, { recursive: true });
    BUILD_FILES_TO_COPY.forEach((fileName) => {
        const source = path.join(ROOT, 'build', fileName);
        const target = path.join(buildDir, fileName);
        if (!fs.existsSync(source)) {
            throw new Error(`Missing source build file: build/${fileName}`);
        }
        fs.copyFileSync(source, target);
    });
};

const runNode = (scriptPath, cwd) => {
    const result = spawnSync(process.execPath, [scriptPath], { cwd, stdio: 'pipe' });
    if (result.status !== 0) {
        const stderr = (result.stderr || '').toString().trim();
        const stdout = (result.stdout || '').toString().trim();
        const details = [stdout, stderr].filter(Boolean).join('\n');
        throw new Error(`Failed to run ${path.basename(scriptPath)}:\n${details}`);
    }
};

const initGeneratedArtifacts = (targetAbs) => {
    runNode(path.join(targetAbs, 'build', 'generate-manifest.js'), targetAbs);
    runNode(path.join(targetAbs, 'build', 'sync-docs.js'), targetAbs);
};

const main = () => {
    const options = parseArgs();
    ensureWritableTarget(options);
    const tokens = {
        PROJECT_NAME: options.name,
        PROJECT_TITLE: options.title,
        PROJECT_DESCRIPTION: options.description,
        INITIAL_VERSION: '0.1.0'
    };

    copyTemplateTree({
        sourceDir: TEMPLATE_ROOT,
        targetDir: options.targetAbs,
        tokens
    });
    copyBuildScripts(options.targetAbs);

    if (!options.skipInit) {
        initGeneratedArtifacts(options.targetAbs);
    }

    console.log(`[blueprint] Scaffolded at ${options.targetAbs}`);
    console.log('[blueprint] Next steps:');
    console.log(`  cd "${options.targetAbs}"`);
    console.log('  npm install');
    console.log('  npm run agent:verify');
};

try {
    main();
} catch (error) {
    console.error(`[blueprint] ${error.message}`);
    process.exit(1);
}
