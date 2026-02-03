import { describe, it, expect } from 'vitest';

describe('ExternalSignalHandlerAdblock', () => {
    it('truncates message and url to the log message limit', () => {
        const handler = ExternalSignalHandlerAdblock.create();
        const initialCount = Logger.getLogs().length;
        const longMessage = 'm'.repeat(CONFIG.logging.LOG_MESSAGE_MAX_LEN + 50);
        const longUrl = 'u'.repeat(CONFIG.logging.LOG_MESSAGE_MAX_LEN + 25);

        handler(
            {
                type: 'adblock',
                level: 'warn',
                message: longMessage,
                url: longUrl
            },
            {
                truncateMessage: ExternalSignalUtils.truncateMessage
            }
        );

        const entry = Logger.getLogs().slice(initialCount).pop();
        expect(entry).toBeDefined();
        expect(entry.message).toBe(LogTags.TAG.ADBLOCK_HINT);
        expect(entry.detail.message.length).toBe(CONFIG.logging.LOG_MESSAGE_MAX_LEN);
        expect(entry.detail.url.length).toBe(CONFIG.logging.LOG_MESSAGE_MAX_LEN);
    });

    it('fills missing fields with unknown and null url', () => {
        const handler = ExternalSignalHandlerAdblock.create();
        const initialCount = Logger.getLogs().length;

        handler({}, { truncateMessage: ExternalSignalUtils.truncateMessage });

        const entry = Logger.getLogs().slice(initialCount).pop();
        expect(entry).toBeDefined();
        expect(entry.detail.type).toBe('unknown');
        expect(entry.detail.level).toBe('unknown');
        expect(entry.detail.url).toBeNull();
    });
});
