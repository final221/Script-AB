import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT, 'src', 'config', 'Config.js');
const CONFIG_DOC_PATH = path.join(ROOT, 'docs', 'CONFIG.md');

const loadConfig = () => {
    const content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const scope = globalThis;
    // eslint-disable-next-line no-eval
    (0, eval)(`${content}\nthis.__CONFIG__ = CONFIG;`);
    return scope.__CONFIG__ || global.CONFIG || globalThis.CONFIG;
};

const extractDocKeys = (content) => {
    const keys = new Set();
    const lines = content.split(/\r?\n/);
    lines.forEach((line) => {
        const match = /^\|\s*([A-Za-z0-9_]+)\s*\|/.exec(line);
        if (match && match[1] !== 'Key' && match[1] !== '---') {
            keys.add(match[1]);
        }
    });
    return keys;
};

describe('Config docs', () => {
    it('docs/CONFIG.md includes all config keys', () => {
        const config = loadConfig();
        expect(config).toBeDefined();
        const doc = fs.readFileSync(CONFIG_DOC_PATH, 'utf8');
        const docKeys = extractDocKeys(doc);

        const flatten = (obj) => {
            const keys = [];
            Object.entries(obj).forEach(([key, value]) => {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    Object.keys(value).forEach((child) => keys.push(child));
                } else {
                    keys.push(key);
                }
            });
            return keys;
        };

        const configKeys = flatten(config);
        const missing = configKeys.filter(key => !docKeys.has(key));
        expect(missing).toEqual([]);
    });
});
