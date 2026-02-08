import { describe, it, expect, vi, afterEach } from 'vitest';

describe('ExternalSignalHandlerAsset', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Logger.getLogs().length = 0;
        document.body.innerHTML = '';
    });

    it('skips candidate switching while failover is active', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const video = document.createElement('video');
        const monitorsById = new Map([
            ['video-1', { video, monitor: { state: {} } }]
        ]);

        const candidateSelector = {
            activateProbation: vi.fn(),
            evaluateCandidates: vi.fn().mockReturnValue({ id: 'video-1' }),
            forceSwitch: vi.fn().mockReturnValue({ activeId: 'video-1', activeIsStalled: false }),
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
        expect(candidateSelector.evaluateCandidates).not.toHaveBeenCalled();
        expect(candidateSelector.forceSwitch).not.toHaveBeenCalled();
        expect(helpers.logCandidateSnapshot).toHaveBeenCalled();
        expect(onRescan).toHaveBeenCalled();
        const recoveryStartLogged = addSpy.mock.calls.some((call) => (
            call[0]?.message === LogTags.TAG.ASSET_HINT
            && call[0]?.detail?.message === 'Processing/offline asset recovery initiated'
        ));
        const failoverSkipLogged = addSpy.mock.calls.some((call) => (
            call[0]?.message === LogTags.TAG.ASSET_HINT_SKIP
            && call[0]?.detail?.message === 'Processing asset recovery skipped during failover'
        ));
        expect(recoveryStartLogged).toBe(true);
        expect(failoverSkipLogged).toBe(true);
    });

    it('logs processing-asset recovery decisions end-to-end', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const primary = document.createElement('video');
        const secondary = document.createElement('video');
        secondary.play = vi.fn().mockResolvedValue();
        const monitorsById = new Map([
            ['video-1', { video: primary, monitor: { state: {} } }],
            ['video-2', { video: secondary, monitor: { state: {} } }]
        ]);

        const candidateSelector = {
            activateProbation: vi.fn(),
            evaluateCandidates: vi.fn().mockReturnValue({
                id: 'video-2',
                score: 8,
                progressEligible: true,
                trusted: true
            }),
            forceSwitch: vi.fn().mockReturnValue({
                activeId: 'video-1',
                activeIsStalled: true,
                suppressed: true,
                switched: false
            }),
            getActiveId: vi.fn()
                .mockReturnValueOnce('video-1')
                .mockReturnValueOnce('video-2')
                .mockReturnValue('video-2'),
            selectEmergencyCandidate: vi.fn().mockReturnValue({ id: 'video-2' })
        };
        const recoveryManager = {
            isFailoverActive: () => false,
            probeCandidate: vi.fn().mockReturnValue(true)
        };

        const handler = window.ExternalSignalHandlerAsset.create({
            monitorsById,
            candidateSelector,
            recoveryManager,
            logDebug: vi.fn(),
            onRescan: vi.fn()
        });

        const helpers = {
            truncateMessage: (message) => message,
            logCandidateSnapshot: vi.fn(),
            probeCandidates: vi.fn()
        };

        const result = handler({ level: 'warn', message: 'processing asset' }, helpers);

        expect(result).toBe(true);
        expect(recoveryManager.probeCandidate).toHaveBeenCalledWith('video-2', 'processing_asset');
        expect(helpers.probeCandidates).toHaveBeenCalledWith(
            recoveryManager,
            monitorsById,
            'processing_asset',
            'video-2'
        );
        expect(secondary.play).toHaveBeenCalled();

        const messages = addSpy.mock.calls
            .map((call) => call[0]?.detail?.message)
            .filter(Boolean);

        expect(messages).toContain('Processing/offline asset recovery initiated');
        expect(messages).toContain('Candidate evaluation complete');
        expect(messages).toContain('Forced switch decision applied');
        expect(messages).toContain('Suppressed switch follow-up probe attempted');
        expect(messages).toContain('Last-resort candidate decision evaluated');
        expect(messages).toContain('Probe burst requested for stalled active candidate');
        expect(messages).toContain('Play attempt issued after processing asset recovery');
    });
});
