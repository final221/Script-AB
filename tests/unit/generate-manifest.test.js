import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import generateManifestModule from '../../build/generate-manifest.js';

const { generateManifest } = generateManifestModule;
const tempDirs = [];

const writeFile = (baseDir, relPath, content) => {
    const absPath = path.join(baseDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
};

const createWorkspace = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-adb-generate-manifest-'));
    tempDirs.push(root);
    const srcDir = path.join(root, 'src');
    const buildDir = path.join(root, 'build');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(buildDir, { recursive: true });

    writeFile(srcDir, 'a.js', '// @module A\nconst A = true;\n');
    writeFile(srcDir, 'b.js', '// @module B\nconst B = true;\n');
    writeFile(srcDir, 'entry.js', '// @module Entry\nconst Entry = true;\n');

    return { root, srcDir, buildDir };
};

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('generate-manifest', () => {
    it('uses legacy manifest as canonical hint instead of current manifest order', () => {
        const { srcDir, buildDir } = createWorkspace();
        const manifestPath = path.join(buildDir, 'manifest.json');
        const legacyManifestPath = path.join(buildDir, 'manifest.legacy.json');
        const current = {
            priority: ['b.js', 'a.js'],
            entry: 'entry.js'
        };
        const legacy = {
            priority: ['a.js', 'b.js'],
            entry: 'entry.js'
        };

        fs.writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n');
        fs.writeFileSync(legacyManifestPath, JSON.stringify(legacy, null, 2) + '\n');

        const checkResult = generateManifest({
            check: true,
            srcDir,
            manifestPath,
            legacyManifestPath,
            entry: 'entry.js'
        });

        expect(checkResult.ok).toBe(false);
        expect(checkResult.manifest.priority).toEqual(['a.js', 'b.js']);
    });

    it('uses deterministic path fallback when no legacy manifest exists', () => {
        const { srcDir, buildDir } = createWorkspace();
        const manifestPath = path.join(buildDir, 'manifest.json');
        const legacyManifestPath = path.join(buildDir, 'missing-legacy.json');
        const current = {
            priority: ['b.js', 'a.js'],
            entry: 'entry.js'
        };

        fs.writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n');

        const checkResult = generateManifest({
            check: true,
            srcDir,
            manifestPath,
            legacyManifestPath,
            entry: 'entry.js'
        });

        expect(checkResult.ok).toBe(false);
        expect(checkResult.manifest.priority).toEqual(['a.js', 'b.js']);
    });
});
