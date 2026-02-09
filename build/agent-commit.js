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
    'data',
    'blueprint'
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
run('git', ['push']);
