import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import loadOrderModule from '../../build/load-order.js';

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT, 'build', 'manifest.json');
const SRC_DIR = path.join(ROOT, 'src');
const { getLoadOrder } = loadOrderModule;

const fileExists = (relativePath) => fs.existsSync(path.join(SRC_DIR, relativePath));
const toRel = (filePath) => path.relative(SRC_DIR, filePath).replace(/\\/g, '/');

describe('Manifest', () => {
    it('contains existing files and no duplicates', () => {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        const priority = manifest.priority || [];
        const seen = new Set();

        priority.forEach((entry) => {
            expect(fileExists(entry)).toBe(true);
            expect(seen.has(entry)).toBe(false);
            seen.add(entry);
        });

        expect(fileExists(manifest.entry)).toBe(true);
        expect(priority.includes(manifest.entry)).toBe(false);
    });

    it('keeps LogTags ahead of LogEvents', () => {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        const priority = manifest.priority || [];
        const tagIndex = priority.indexOf('monitoring/LogTags.js');
        const eventsIndex = priority.indexOf('monitoring/LogEvents.js');

        expect(tagIndex).toBeGreaterThan(-1);
        expect(eventsIndex).toBeGreaterThan(-1);
        expect(tagIndex).toBeLessThan(eventsIndex);
    });

    it('keeps log tag groups/schema ahead of registry', () => {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        const priority = manifest.priority || [];
        const groupsIndex = priority.indexOf('monitoring/LogTagGroups.js');
        const schemasIndex = priority.indexOf('monitoring/LogTagSchemas.js');
        const registryIndex = priority.indexOf('monitoring/LogTagRegistry.js');

        expect(groupsIndex).toBeGreaterThan(-1);
        expect(schemasIndex).toBeGreaterThan(-1);
        expect(registryIndex).toBeGreaterThan(-1);
        expect(groupsIndex).toBeLessThan(registryIndex);
        expect(schemasIndex).toBeLessThan(registryIndex);
    });

    it('builds a deterministic graph load order', () => {
        const first = getLoadOrder({ srcDir: SRC_DIR, manifestPath: MANIFEST_PATH, mode: 'graph' });
        const second = getLoadOrder({ srcDir: SRC_DIR, manifestPath: MANIFEST_PATH, mode: 'graph' });
        const firstRel = first.loadOrder.map(toRel);
        const secondRel = second.loadOrder.map(toRel);

        expect(first.mode).toBe('graph');
        expect(firstRel).toEqual(secondRel);

        const seen = new Set();
        firstRel.forEach((relPath) => {
            expect(fileExists(relPath)).toBe(true);
            expect(seen.has(relPath)).toBe(false);
            seen.add(relPath);
        });

        expect(toRel(first.entryFile)).toBe('core/orchestrators/CoreOrchestrator.js');
    });

    it('rejects legacy rollback mode', () => {
        expect(() => getLoadOrder({ srcDir: SRC_DIR, manifestPath: MANIFEST_PATH, mode: 'legacy' }))
            .toThrow(/Unsupported MANIFEST_MODE/);
    });
});
