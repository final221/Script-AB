import { describe, it, expect, vi, afterEach } from 'vitest';
import { setBufferedRanges } from '../helpers/video.js';

describe('ExternalSignalHandlerStall', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('triggers stall handling once console stall exceeds threshold', () => {
        const video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        setBufferedRanges(video, [[0, 20]]);

        const now = Date.now();
        const state = {
            hasProgress: true,
            lastProgressTime: now - (CONFIG.stall.STALL_CONFIRM_MS + 1),
            pauseFromStall: false,
            lastStallEventTime: 0
        };
        const monitorsById = new Map([
            ['video-1', { video, monitor: { state } }]
        ]);
        const candidateSelector = { getActiveId: () => 'video-1' };
        const onStallDetected = vi.fn();
        const playheadAttribution = {
            resolve: vi.fn().mockReturnValue({
                id: 'video-1',
                playheadSeconds: 10,
                activeId: 'video-1',
                reason: 'match',
                match: { deltaSeconds: 0.1 },
                candidates: []
            })
        };

        const handler = window.ExternalSignalHandlerStall.create({
            monitorsById,
            candidateSelector,
            onStallDetected,
            playheadAttribution
        });

        vi.spyOn(Date, 'now').mockReturnValue(now);
        vi.spyOn(BufferGapFinder, 'isBufferExhausted').mockReturnValue(true);

        handler(
            { level: 'warn', message: 'stall', bufferEndSeconds: 12, playheadSeconds: 10 },
            ExternalSignalUtils
        );

        expect(state.pauseFromStall).toBe(true);
        expect(state.lastStallEventTime).toBe(now);
        expect(onStallDetected).toHaveBeenCalledWith(
            video,
            expect.objectContaining({
                trigger: 'CONSOLE_STALL',
                bufferExhausted: true,
                pauseFromStall: true
            }),
            state
        );
    });
});
