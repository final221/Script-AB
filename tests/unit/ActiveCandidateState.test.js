import { describe, it, expect, vi } from 'vitest';

describe('ActiveCandidateState', () => {
    it('tracks active candidate transitions and last-good state', () => {
        const onSwitch = vi.fn();
        const onActive = vi.fn();
        const state = window.ActiveCandidateState.create({
            onSwitch,
            onActive
        });

        expect(state.getActiveId()).toBeNull();
        expect(state.getLastGoodId()).toBeNull();

        state.activateCandidate('video-1', 'initial');
        state.setLastGoodId('video-1');
        state.activateCandidate('video-2', 'switch');

        expect(state.getActiveId()).toBe('video-2');
        expect(state.getLastGoodId()).toBe('video-1');
        expect(onSwitch).toHaveBeenCalledTimes(1);
        expect(onSwitch).toHaveBeenCalledWith({
            fromId: 'video-1',
            toId: 'video-2',
            reason: 'switch'
        });
        expect(onActive).toHaveBeenCalledWith('video-1', 'initial');
        expect(onActive).toHaveBeenCalledWith('video-2', 'switch');
    });

    it('uses evaluation timing to throttle redundant interval checks', () => {
        const state = window.ActiveCandidateState.create();

        expect(state.shouldRunIntervalEvaluation(1000, 1000)).toBe(true);

        state.noteEvaluation('stall', 2000);

        expect(state.shouldRunIntervalEvaluation(1000, 2500)).toBe(false);
        expect(state.shouldRunIntervalEvaluation(1000, 3001)).toBe(true);

        state.clearActive('idle');
        expect(state.getActiveId()).toBeNull();
    });
});
