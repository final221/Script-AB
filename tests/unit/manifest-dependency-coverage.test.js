import path from 'path';
import { describe, it, expect } from 'vitest';
import manifestGraphModule from '../../build/manifest-graph.js';

const { collectModuleMetadata, buildDependencyGraph } = manifestGraphModule;
const ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');

describe('Manifest dependency coverage', () => {
    it('keeps dependency metadata coverage high', () => {
        const metadata = collectModuleMetadata(SRC_DIR);
        const graph = buildDependencyGraph(metadata.moduleToEntry);
        let modulesWithDepends = 0;

        metadata.moduleToEntry.forEach((entry) => {
            if (Array.isArray(entry.depends) && entry.depends.length > 0) {
                modulesWithDepends += 1;
            }
        });

        expect(metadata.missingModule.length).toBe(0);
        expect(metadata.duplicates.length).toBe(0);
        expect(graph.unresolvedDependencies.length).toBe(0);
        expect(modulesWithDepends).toBeGreaterThanOrEqual(metadata.moduleToEntry.size - 1);
        expect(graph.edgeCount).toBeGreaterThanOrEqual(metadata.moduleToEntry.size - 1);
    });
});
