const { spawnSync } = require('child_process');

const run = (command, args) => {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
};

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

run(npmCmd, ['run', 'build']);
run('node', ['build/check-clean.js']);
run('git', ['status', '-sb']);
