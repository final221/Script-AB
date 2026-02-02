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

describe('ExternalSignalUtils.truncateMessage', () => {
    it('caps messages to the configured max length', () => {
        const maxLen = CONFIG.logging.LOG_MESSAGE_MAX_LEN;
        const message = 'a'.repeat(maxLen + 10);

        const result = ExternalSignalUtils.truncateMessage(message);

        expect(result.length).toBe(maxLen);
        expect(result).toBe(message.slice(0, maxLen));
    });
});
