import { describe, it, expect } from 'vitest';

describe('ExternalSignalUtils.getActiveEntry', () => {
    it('falls back to the first monitor when active id is missing', () => {
        const monitorsById = new Map([
            ['video-1', { video: document.createElement('video') }],
            ['video-2', { video: document.createElement('video') }]
        ]);
        const candidateSelector = { getActiveId: () => 'video-missing' };

        const result = ExternalSignalUtils.getActiveEntry(candidateSelector, monitorsById);

        expect(result.id).toBe('video-1');
        expect(result.entry).toBe(monitorsById.get('video-1'));
    });
});
