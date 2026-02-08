import path from 'path';
import { spawnSync } from 'child_process';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

describe('check-manifest-metadata', () => {
    it('fails fast on invalid MODULE_METADATA_POLICY', () => {
        const result = spawnSync(process.execPath, ['build/check-manifest-metadata.js'], {
            cwd: ROOT,
            env: {
                ...process.env,
                MODULE_METADATA_POLICY: 'invalid-policy'
            },
            encoding: 'utf8'
        });

        expect(result.status).toBe(1);
        expect(`${result.stdout}\n${result.stderr}`).toMatch(/Invalid MODULE_METADATA_POLICY/);
    });
});
