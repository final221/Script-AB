import { describe, it, expect, vi, afterEach } from 'vitest';

describe('ExternalSignalHandlerFallback', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs unhandled signals with EXTERNAL tag and truncates message', () => {
        const addSpy = vi.spyOn(window.Logger, 'add');
        const handler = window.ExternalSignalHandlerFallback.create();
        const longMessage = 'x'.repeat(CONFIG.logging.LOG_MESSAGE_MAX_LEN + 50);
        const helpers = { truncateMessage: window.ExternalSignalUtils.truncateMessage };

        const result = handler({ type: 'custom', level: 'warn', message: longMessage }, helpers);

        expect(result).toBe(true);
        expect(addSpy).toHaveBeenCalledTimes(1);

        const [event, detail] = addSpy.mock.calls[0];
        const expectedTag = window.LogTags?.TAG?.EXTERNAL || 'EXTERNAL';
        const expectedMessage = longMessage.substring(0, CONFIG.logging.LOG_MESSAGE_MAX_LEN);

        expect(event.message).toBe(expectedTag);
        expect(event.detail?.message).toBe('Unhandled external signal');
        expect(detail).toEqual(expect.objectContaining({
            type: 'custom',
            level: 'warn',
            message: expectedMessage
        }));
    });
});
