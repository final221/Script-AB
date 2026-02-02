import { describe, it, expect, vi, afterEach } from 'vitest';

describe('ExternalSignalRouter', () => {
    let addSpy;

    afterEach(() => {
        if (addSpy) {
            addSpy.mockRestore();
            addSpy = null;
        }
    });

    it('logs unhandled signals via the fallback handler', () => {
        const video = document.createElement('video');
        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: {} } }]
        ]);
        const candidateSelector = { getActiveId: () => 'video-1' };
        const recoveryManager = { requestRefresh: vi.fn(), isFailoverActive: () => false };
        const router = window.ExternalSignalRouter.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug: () => {},
            onStallDetected: () => {},
            onRescan: () => {}
        });

        addSpy = vi.spyOn(Logger, 'add').mockImplementation(() => {});

        router.handleSignal({ type: 'mystery_signal', message: 'oops' });

        expect(addSpy).toHaveBeenCalled();
        const logged = addSpy.mock.calls[0][0];
        expect(logged.message).toBe(LogTags.TAG.EXTERNAL);
    });

    it('requests refresh when decoder error targets an active video', () => {
        const video = document.createElement('video');
        const monitorState = {};
        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: monitorState } }]
        ]);
        const candidateSelector = { getActiveId: () => 'video-1' };
        const recoveryManager = {
            requestRefresh: vi.fn(),
            isFailoverActive: () => false
        };
        const router = window.ExternalSignalRouter.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug: () => {},
            onStallDetected: () => {},
            onRescan: () => {}
        });

        router.handleSignal({
            type: 'decoder_error',
            level: 'error',
            message: 'decoder blew up'
        });

        expect(recoveryManager.requestRefresh).toHaveBeenCalledTimes(1);
        expect(recoveryManager.requestRefresh).toHaveBeenCalledWith(
            'video-1',
            monitorState,
            expect.objectContaining({
                reason: 'decoder_error',
                trigger: 'decoder_error',
                detail: 'decoder blew up'
            })
        );
    });
});
