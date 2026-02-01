import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(ROOT, 'build', 'manifest.json');
const SRC_DIR = path.join(ROOT, 'src');

const fileExists = (relativePath) => fs.existsSync(path.join(SRC_DIR, relativePath));

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
});
