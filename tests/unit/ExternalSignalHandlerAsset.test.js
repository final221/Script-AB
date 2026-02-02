import { describe, it, expect, vi } from 'vitest';

describe('ExternalSignalHandlerAsset', () => {
    it('skips forced switching while failover is active', () => {
        const video = document.createElement('video');
        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: {} } }]
        ]);

        const candidateSelector = {
            activateProbation: vi.fn(),
            evaluateCandidates: vi.fn(),
            forceSwitch: vi.fn(),
            getActiveId: vi.fn().mockReturnValue('video-1'),
            selectEmergencyCandidate: vi.fn()
        };
        const recoveryManager = {
            isFailoverActive: () => true,
            probeCandidate: vi.fn()
        };
        const logDebug = vi.fn();
        const onRescan = vi.fn();

        const handler = window.ExternalSignalHandlerAsset.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug,
            onRescan
        });

        const helpers = {
            truncateMessage: (message) => message,
            logCandidateSnapshot: vi.fn(),
            probeCandidates: vi.fn()
        };

        const result = handler({ level: 'error', message: 'processing asset' }, helpers);

        expect(result).toBe(true);
        expect(logDebug).toHaveBeenCalled();
        expect(logDebug.mock.calls[0][0]?.message).toBe(LogTags.TAG.ASSET_HINT_SKIP);
        expect(candidateSelector.forceSwitch).not.toHaveBeenCalled();
        expect(candidateSelector.evaluateCandidates).not.toHaveBeenCalled();
        expect(helpers.logCandidateSnapshot).toHaveBeenCalled();
        expect(onRescan).toHaveBeenCalled();
    });
});
