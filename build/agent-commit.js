const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const run = (command, args, opts = {}) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : command;
    const cmdArgs = isWin ? ['/c', command, ...args] : args;
    const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
};

const runCapture = (command, args) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : command;
    const cmdArgs = isWin ? ['/c', command, ...args] : args;
    return spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
};

const listRemotes = () => {
    const result = runCapture('git', ['remote']);
    if (result.status !== 0) return [];
    return (result.stdout || '')
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
};

const getPushRemote = () => {
    const remotes = listRemotes();
    if (remotes.length === 0) return null;
    if (remotes.includes('origin')) return 'origin';
    return remotes[0];
};

const getCurrentBranch = () => {
    const result = runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (result.status !== 0) return null;
    const branch = (result.stdout || '').toString().trim();
    if (!branch || branch === 'HEAD') return null;
    return branch;
};

const hasUpstream = () => {
    const result = runCapture('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return result.status === 0;
};

const pushWithTrackingIfNeeded = () => {
    const remote = getPushRemote();
    if (!remote) {
        console.warn('[agent:commit] No git remote configured; commit created locally only.');
        return;
    }

    if (hasUpstream()) {
        run('git', ['push']);
        return;
    }

    const branch = getCurrentBranch();
    if (!branch) {
        run('git', ['push']);
        return;
    }

    console.warn(`[agent:commit] No upstream for ${branch}; pushing with --set-upstream ${remote} ${branch}.`);
    run('git', ['push', '--set-upstream', remote, branch]);
};

const commitMessage = process.env.COMMIT_MSG || process.env.COMMIT_MESSAGE;
if (!commitMessage) {
    console.error('[agent:commit] Missing COMMIT_MSG (or COMMIT_MESSAGE).');
    process.exit(1);
}

const filesToAdd = [
    'AGENTS.md',
    'README.md',
    'build/agent-commit.js',
    'build/version.txt',
    'dist/code.js',
    'docs/CHANGELOG.md',
    'package-lock.json',
    'package.json',
];

const rootsToAdd = [
    'src',
    'tests',
    'docs',
    'build',
    'data'
];

const existingRoots = rootsToAdd.filter((entry) => (
    fs.existsSync(path.join(process.cwd(), entry))
));
const existingFiles = filesToAdd.filter((entry) => (
    fs.existsSync(path.join(process.cwd(), entry))
));

// Stage all tracked edits/deletions first so source changes are never skipped.
run('git', ['add', '-u']);

// Stage generated/release and source roots (includes new files in these roots).
run('git', ['add', ...existingFiles, ...existingRoots]);

run('git', ['commit', '-m', commitMessage]);
pushWithTrackingIfNeeded();
