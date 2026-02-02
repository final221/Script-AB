const { spawnSync } = require('child_process');

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

run('git', ['add', ...filesToAdd]);
run('git', ['commit', '-m', commitMessage]);
run('git', ['push']);
