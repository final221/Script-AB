import { describe, it, expect, vi, afterEach } from 'vitest';

describe('CandidateSelectionLogger', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('logs decisions immediately for non-interval reasons', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const logger = window.CandidateSelectionLogger.create({ logDebug: () => {} });

        logger.logOutcome({
            action: 'switch',
            reason: 'manual',
            fromId: 'video-1',
            toId: 'video-2',
            preferred: { score: 5, progressEligible: true, trusted: true }
        });

        const decisionLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.CANDIDATE_DECISION
        );
        expect(decisionLogs.length).toBe(1);
    });

    it('throttles interval decision logs until the active log window elapses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const addSpy = vi.spyOn(Logger, 'add');
        const logger = window.CandidateSelectionLogger.create({ logDebug: () => {} });

        logger.logOutcome({
            action: 'switch',
            reason: 'interval',
            fromId: 'video-1',
            toId: 'video-2',
            preferred: { score: 5, progressEligible: true, trusted: true }
        });

        expect(addSpy).not.toHaveBeenCalled();

        vi.setSystemTime(CONFIG.logging.ACTIVE_LOG_MS + 1);
        logger.logOutcome({
            action: 'switch',
            reason: 'interval',
            fromId: 'video-1',
            toId: 'video-2',
            preferred: { score: 5, progressEligible: true, trusted: true }
        });

        const decisionLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.CANDIDATE_DECISION
        );
        expect(decisionLogs.length).toBe(1);
    });

    it('emits suppression summaries after the suppression window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const addSpy = vi.spyOn(Logger, 'add');
        const logger = window.CandidateSelectionLogger.create({ logDebug: () => {} });

        logger.logOutcome({
            action: 'stay',
            reason: 'interval',
            suppression: 'score_delta',
            fromId: 'video-1',
            toId: 'video-2',
            activeState: MonitorStates.STALLED,
            probationActive: false,
            scores: []
        });

        vi.setSystemTime(CONFIG.logging.SUPPRESSION_LOG_MS + 1);
        logger.logOutcome({
            action: 'stay',
            reason: 'interval',
            suppression: 'score_delta',
            fromId: 'video-1',
            toId: 'video-2',
            activeState: MonitorStates.STALLED,
            probationActive: false,
            scores: []
        });

        const suppressionLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.SUPPRESSION
        );
        expect(suppressionLogs.length).toBe(1);
    });

    it('sends non-interval suppressions to logDebug only', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const logDebug = vi.fn();
        const logger = window.CandidateSelectionLogger.create({ logDebug });

        logger.logOutcome({
            action: 'stay',
            reason: 'manual',
            suppression: 'score_delta',
            fromId: 'video-1',
            toId: 'video-2',
            activeState: MonitorStates.STALLED,
            probationActive: false,
            scores: []
        });

        const suppressionLogs = addSpy.mock.calls.filter(
            (call) => call[0]?.message === LogTags.TAG.SUPPRESSION
        );
        expect(suppressionLogs.length).toBe(0);
        expect(logDebug).toHaveBeenCalled();
    });

    it('skips logging when decision action is none', () => {
        const addSpy = vi.spyOn(Logger, 'add');
        const logger = window.CandidateSelectionLogger.create({ logDebug: () => {} });

        logger.logOutcome({ action: 'none', reason: 'interval' });

        expect(addSpy).not.toHaveBeenCalled();
    });
});
