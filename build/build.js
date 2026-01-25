const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
    BASE: path.join(__dirname, '..'),
    OUT: path.join(__dirname, '..', 'dist', 'code.js'),
    HEADER: path.join(__dirname, 'header.js'),
    VERSION: path.join(__dirname, 'version.txt'),
    MANIFEST: path.join(__dirname, 'manifest.json'),
    CHANGELOG: path.join(__dirname, '..', 'docs', 'CHANGELOG.md')
};

/**
 * Recursively gets all files in a directory.
 * @param {string} dir - The directory to search.
 * @returns {string[]} List of absolute file paths.
 */
const getFiles = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);

    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            results = results.concat(getFiles(filePath));
        } else {
            results.push(filePath);
        }
    }

    return results;
};

/**
 * Updates the semantic version in the version file.
 * @param {'major'|'minor'|'patch'} type - The type of version bump.
 * @returns {{old: string, new: string}} The old and new versions.
 */
const updateVersion = (type = 'patch') => {
    let version = '1.0.0';
    try {
        version = fs.readFileSync(CONFIG.VERSION, 'utf8').trim();
    } catch (e) {
        // Version file might not exist yet, defaulting to 1.0.0
    }

    const parts = version.split('.').map(Number);

    if (type === 'major') {
        parts[0]++;
        parts[1] = 0;
        parts[2] = 0;
    } else if (type === 'minor') {
        parts[1]++;
        parts[2] = 0;
    } else {
        parts[2]++;
    }

    const newVersion = parts.join('.');
    fs.writeFileSync(CONFIG.VERSION, newVersion);

    // Sync with package.json
    const packageJsonPath = path.join(CONFIG.BASE, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageJson.version = newVersion;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }

    // Sync README current version
    const readmePath = path.join(CONFIG.BASE, 'README.md');
    if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, 'utf8');
        const updated = readme.replace(/Current:\s+\*\*\d+\.\d+\.\d+\*\*/g, `Current: **${newVersion}**`);
        if (updated !== readme) {
            fs.writeFileSync(readmePath, updated);
        }
    }

    updateChangelog(version, newVersion);

    return { old: version, new: newVersion };
};

const updateChangelog = (oldVersion, newVersion) => {
    const changelogPath = CONFIG.CHANGELOG;
    let existing = '';
    let newline = '\n';
    if (fs.existsSync(changelogPath)) {
        existing = fs.readFileSync(changelogPath, 'utf8');
        newline = existing.includes('\r\n') ? '\r\n' : '\n';
    }

    const header = '# Changelog';
    if (!existing.trim()) {
        existing = header + newline;
    }

    const match = existing.match(/Commit:\s+([0-9a-f]+)/i);
    const lastHash = match ? match[1] : null;

    const headHash = (() => {
        try {
            return execSync('git rev-parse --short HEAD', {
                cwd: CONFIG.BASE,
                stdio: ['ignore', 'pipe', 'ignore']
            }).toString().trim();
        } catch (e) {
            return null;
        }
    })();

    let commits = [];
    try {
        const range = lastHash ? `${lastHash}..HEAD` : 'HEAD';
        const args = lastHash ? `${range}` : '-n 10';
        const output = execSync(`git log ${args} --pretty=format:%s`, {
            cwd: CONFIG.BASE,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
        commits = output ? output.split(/\r?\n/) : [];
    } catch (e) {
        commits = [];
    }

    const maxCommits = 20;
    const hasMore = commits.length > maxCommits;
    const commitLines = commits.slice(0, maxCommits).map(line => `- ${line}`);
    if (hasMore) {
        commitLines.push(`- ...and ${commits.length - maxCommits} more`);
    }
    if (commitLines.length === 0) {
        commitLines.push('- No commits detected since last build');
    }

    const entryLines = [
        `## ${newVersion} - ${new Date().toISOString()}`,
        `Previous: ${oldVersion}`,
        headHash ? `Commit: ${headHash}` : 'Commit: (git unavailable)',
        'Changes:',
        ...commitLines,
        ''
    ];
    const entry = entryLines.join(newline);

    const withoutHeader = existing.replace(new RegExp(`^${header}\\s*`, 'm'), '');
    const updated = [header, '', entry, withoutHeader.trimStart()].join(newline).trimEnd() + newline;
    fs.writeFileSync(changelogPath, updated);
};

(() => {
    console.log('🏗️  Building Stream Healer...');

    const manifest = JSON.parse(fs.readFileSync(CONFIG.MANIFEST, 'utf8'));
    const priority = Array.isArray(manifest.priority) ? manifest.priority : [];
    const entry = manifest.entry || 'core/orchestrators/CoreOrchestrator.js';

    const args = process.argv.slice(2);
    let versionType = 'patch';

    if (args.includes('--major')) {
        versionType = 'major';
    } else if (args.includes('--minor')) {
        versionType = 'minor';
    }

    const { old, new: version } = updateVersion(versionType);
    console.log(`📦 Version: ${old} → ${version} (${versionType})`);

    if (path.basename(CONFIG.OUT) === path.basename(__filename)) {
        return console.error('❌ Output cannot be build script');
    }

    const srcDir = path.join(CONFIG.BASE, 'src');
    const allFiles = getFiles(srcDir);
    const normalize = p => path.normalize(p);

    const priorityFiles = priority.map(file => path.join(srcDir, file));
    const entryFile = path.join(srcDir, entry);

    // Filter out: non-js, priority files, entry file
    const otherFiles = allFiles.filter(file => {
        if (!file.endsWith('.js')) return false;

        const isPriority = priorityFiles.some(p => normalize(p) === normalize(file));
        if (isPriority) return false;

        const isEntry = normalize(file) === normalize(entryFile);
        if (isEntry) return false;

        return true;
    });

    const headerContent = fs.existsSync(CONFIG.HEADER)
        ? fs.readFileSync(CONFIG.HEADER, 'utf8').replace('{{VERSION}}', version) + '\n'
        : '';

    const combinedContent = [...priorityFiles, ...otherFiles, entryFile].map(file => {
        console.log(`   + ${path.relative(srcDir, file)}`);
        return fs.readFileSync(file, 'utf8');
    }).join('\n');

    try {
        const injectedContent = combinedContent.replace(/__BUILD_VERSION__/g, version);
        const finalOutput = `${headerContent}(function () {\n    'use strict';\n\n${injectedContent}\n})();\n`;
        fs.writeFileSync(CONFIG.OUT, finalOutput);
        console.log(`✅ Built: ${CONFIG.OUT} (${(injectedContent.length / 1024).toFixed(2)} KB)`);
    } catch (e) {
        console.error(`❌ Error: ${e.message}`);
    }
})();
