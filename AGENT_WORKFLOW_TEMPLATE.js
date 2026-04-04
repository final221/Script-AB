#!/usr/bin/env node
/**
 * Reusable agent workflow scaffold.
 *
 * Copy this file into a target repository, usually as:
 *   build/agent-workflow.js
 *
 * Then wire package scripts like:
 *   "agent:verify": "node build/agent-workflow.js verify",
 *   "agent:commit": "node build/agent-workflow.js commit"
 *
 * This template is intentionally generic. Edit WORKFLOW to match the repo.
 * It provides the preferred `agent:verify` and `agent:commit` entrypoints,
 * and the preferred inputs:
 *   BUMP=patch|minor|major|none
 *   COMMIT_MSG="..."
 * but it does not guess the repo's real verify/build/stage rules for you.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const VALID_BUMPS = new Set(['patch', 'minor', 'major', 'none']);

const WORKFLOW = {
    verify: {
        /*
         * Replace these steps with the target repo's real verification flow.
         * The defaults below are a reasonable JS/TS starting point.
         */
        steps: [
            { command: npmCmd, args: ['test'], optional: false },
            { command: npmCmd, args: ['run', 'build'], optional: false },
            { command: 'git', args: ['status', '-sb'], optional: true }
        ]
    },
    commit: {
        /*
         * Add the generated files and source roots that should be staged.
         * Tracked edits/deletions are staged automatically via `git add -u`.
         */
        filesToAdd: [
            'AGENTS.md',
            'README.md',
            'package.json',
            'package-lock.json'
        ],
        rootsToAdd: [
            'src',
            'tests',
            'docs',
            'build'
        ],
        pushAfterCommit: true
    }
};

const fail = (message) => {
    console.error(message);
    process.exit(1);
};

const normalizeBump = (value) => {
    if (!value) return null;
    const normalized = String(value).trim().toLowerCase();
    return VALID_BUMPS.has(normalized) ? normalized : null;
};

const run = (command, args, opts = {}) => {
    const cmd = isWin ? 'cmd.exe' : command;
    const cmdArgs = isWin ? ['/c', command, ...args] : args;
    const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
};

const runCapture = (command, args) => {
    const cmd = isWin ? 'cmd.exe' : command;
    const cmdArgs = isWin ? ['/c', command, ...args] : args;
    return spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
};

const pathExists = (entry) => fs.existsSync(path.join(process.cwd(), entry));

const filterExisting = (entries = []) => entries.filter(pathExists);

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
        console.warn('[agent-workflow] No git remote configured; commit created locally only.');
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

    console.warn(`[agent-workflow] No upstream for ${branch}; pushing with --set-upstream ${remote} ${branch}.`);
    run('git', ['push', '--set-upstream', remote, branch]);
};

const runVerify = () => {
    const bump = process.env.BUMP;
    if (bump) {
        const normalizedBump = normalizeBump(bump);
        if (!normalizedBump) {
            fail(`[agent-workflow] Invalid BUMP="${bump}". Expected one of: patch, minor, major, none.`);
        }
    }

    WORKFLOW.verify.steps.forEach((step) => {
        const args = Array.isArray(step.args) ? step.args : [];
        if (step.whenExists && !pathExists(step.whenExists)) {
            return;
        }
        if (step.optional && step.command !== 'git' && !pathExists(step.command)) {
            return;
        }
        run(step.command, args, step.opts || {});
    });
};

const runCommit = () => {
    const commitMessage = process.env.COMMIT_MSG || process.env.COMMIT_MESSAGE;
    if (!commitMessage) {
        fail('[agent-workflow] Missing COMMIT_MSG (or COMMIT_MESSAGE).');
    }

    const filesToAdd = filterExisting(WORKFLOW.commit.filesToAdd);
    const rootsToAdd = filterExisting(WORKFLOW.commit.rootsToAdd);

    run('git', ['add', '-u']);

    if (filesToAdd.length || rootsToAdd.length) {
        run('git', ['add', ...filesToAdd, ...rootsToAdd]);
    }

    run('git', ['commit', '-m', commitMessage]);

    if (WORKFLOW.commit.pushAfterCommit) {
        pushWithTrackingIfNeeded();
    }
};

const command = (process.argv[2] || '').trim();

if (command === 'verify') {
    runVerify();
    process.exit(0);
}

if (command === 'commit') {
    runCommit();
    process.exit(0);
}

fail('Usage: node <path>/agent-workflow.js <verify|commit>');
