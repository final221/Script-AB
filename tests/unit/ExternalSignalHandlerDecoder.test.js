import { describe, it, expect, vi } from 'vitest';

describe('ExternalSignalHandlerDecoder', () => {
    it('does not request refresh when no active entry exists', () => {
        const monitorsById = new Map();
        const candidateSelector = { getActiveId: () => null };
        const recoveryManager = { requestRefresh: vi.fn() };
        const handler = ExternalSignalHandlerDecoder.create({
            monitorsById,
            candidateSelector,
            recoveryManager
        });

        const result = handler(
            { type: 'decoder_error', message: 'boom' },
            {
                truncateMessage: ExternalSignalUtils.truncateMessage,
                getActiveEntry: ExternalSignalUtils.getActiveEntry
            }
        );

        expect(result).toBe(true);
        expect(recoveryManager.requestRefresh).not.toHaveBeenCalled();
    });
});
