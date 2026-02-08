const { spawnSync } = require('child_process');

const run = (command, args) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : command;
    const cmdArgs = isWin ? ['/c', command, ...args] : args;
    const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
};

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

run(npmCmd, ['run', 'build']);
run('node', ['build/check-file-size.js']);
run('node', ['build/check-manifest-metadata.js']);
run('node', ['build/check-manifest-graph.js']);
run('node', ['build/check-manifest-shadow.js']);
run('git', ['status', '-sb']);
