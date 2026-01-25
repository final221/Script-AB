import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const SRC_DIR = path.resolve(__dirname, '../../src');

const getFiles = (dir) => {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            results = results.concat(getFiles(filePath));
        } else if (filePath.endsWith('.js')) {
            results.push(filePath);
        }
    }
    return results;
};

const extractTagKeys = (content, regex, output) => {
    let match;
    while ((match = regex.exec(content)) !== null) {
        output.add(match[1]);
    }
};

describe('LogEvents Tag Registry', () => {
    it('LogTags and LogEvents share the same tag map', () => {
        expect(window.LogTags?.TAG).toBeDefined();
        expect(window.LogEvents?.TAG).toBeDefined();
        expect(window.LogEvents.TAG).toEqual(window.LogTags.TAG);
    });

    it('all tagged/pairs usages reference existing tags', () => {
        const files = getFiles(SRC_DIR);
        const usedKeys = new Set();
        const taggedRegex = /LogEvents\.tagged\(\s*['"]([A-Z0-9_]+)['"]/g;
        const pairsRegex = /LogEvents\.pairs\(\s*['"]([A-Z0-9_]+)['"]/g;

        files.forEach((file) => {
            const content = fs.readFileSync(file, 'utf8');
            extractTagKeys(content, taggedRegex, usedKeys);
            extractTagKeys(content, pairsRegex, usedKeys);
        });

        const defined = Object.keys(window.LogEvents?.TAG || {});
        const missing = Array.from(usedKeys).filter(key => !defined.includes(key));
        expect(missing).toEqual([]);
    });
});
