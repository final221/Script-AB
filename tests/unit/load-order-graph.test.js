import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import loadOrderModule from '../../build/load-order.js';

const { getLoadOrder } = loadOrderModule;
const tempDirs = [];

const writeFile = (baseDir, relPath, content) => {
    const absPath = path.join(baseDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
};

const createTempSrc = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-adb-load-order-'));
    tempDirs.push(dir);
    Object.entries(files).forEach(([relPath, content]) => writeFile(dir, relPath, content));
    return dir;
};

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('load-order graph mode', () => {
    it('fails hard when @depends references an unknown module', () => {
        const srcDir = createTempSrc({
            'a.js': [
                '// @module A',
                '// @depends MissingModule',
                'const A = true;'
            ].join('\n'),
            'entry.js': 'const Entry = true;'
        });

        const manifest = { priority: ['a.js'], entry: 'entry.js' };
        expect(() => getLoadOrder({ srcDir, manifest, mode: 'graph' }))
            .toThrow(/Unresolved dependencies/);
    });

    it('fails hard when dependency metadata contains a cycle', () => {
        const srcDir = createTempSrc({
            'a.js': [
                '// @module A',
                '// @depends B',
                'const A = true;'
            ].join('\n'),
            'b.js': [
                '// @module B',
                '// @depends A',
                'const B = true;'
            ].join('\n'),
            'entry.js': 'const Entry = true;'
        });

        const manifest = { priority: ['a.js', 'b.js'], entry: 'entry.js' };
        expect(() => getLoadOrder({ srcDir, manifest, mode: 'graph' }))
            .toThrow(/Dependency cycles/);
    });

    it('rejects legacy mode now that rollback path is removed', () => {
        const srcDir = createTempSrc({
            'a.js': [
                '// @module A',
                'const A = true;'
            ].join('\n'),
            'entry.js': 'const Entry = true;'
        });

        const manifest = { priority: ['a.js'], entry: 'entry.js' };
        expect(() => getLoadOrder({ srcDir, manifest, mode: 'legacy' }))
            .toThrow(/Unsupported MANIFEST_MODE/);
    });
});
