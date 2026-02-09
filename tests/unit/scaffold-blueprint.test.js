import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const tempDirs = [];

const runNode = (cwd, scriptPath, args = []) => {
    execFileSync(process.execPath, [scriptPath, ...args], {
        cwd,
        stdio: 'pipe'
    });
};

const createTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-adb-blueprint-'));
    tempDirs.push(dir);
    return dir;
};

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('scaffold-blueprint', () => {
    it('creates a portable starter repository with initialized metadata', () => {
        const target = createTempDir();
        const scriptPath = path.join(ROOT, 'build', 'scaffold-blueprint.js');
        runNode(ROOT, scriptPath, [
            '--target', target,
            '--name', 'blueprint-test-project',
            '--title', 'Blueprint Test Project',
            '--description', 'Scaffolded project for testing'
        ]);

        const requiredFiles = [
            'AGENTS.md',
            'README.md',
            'package.json',
            'build/agent-verify.js',
            'build/manifest.json',
            'docs/ARCHITECTURE.md',
            'docs/CONFIG.md',
            'docs/LOG_TAGS.md',
            'src/core/orchestrators/CoreOrchestrator.js'
        ];
        requiredFiles.forEach((relPath) => {
            expect(fs.existsSync(path.join(target, relPath))).toBe(true);
        });

        const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
        expect(pkg.name).toBe('blueprint-test-project');
        expect(pkg.version).toBe('0.1.0');

        runNode(target, path.join(target, 'build', 'check-file-size.js'));
        runNode(target, path.join(target, 'build', 'check-manifest-metadata.js'));
        runNode(target, path.join(target, 'build', 'check-manifest-graph.js'));
        runNode(target, path.join(target, 'build', 'sync-docs.js'), ['--check']);
    });
});
