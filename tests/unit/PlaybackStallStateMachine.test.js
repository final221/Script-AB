import { describe, it, expect } from 'vitest';
import { createVideo, defineVideoProps } from '../helpers/video.js';

const createHarness = (overrides = {}) => {
    const video = createVideo({ paused: false, ...overrides });
    const state = PlaybackStateStore.create(video);
    const transitions = PlaybackStateTransitions.create({
        state,
        setState: (nextState, reason) => PlaybackStateStore.setState(state, nextState, { reason })
    });
    const tracker = {
        markStallEvent: () => {
            const now = Date.now();
            state.lastStallEventTime = now;
            if (!state.stallStartTime) {
                state.stallStartTime = now;
            }
            if (!state.pauseFromStall) {
                state.pauseFromStall = true;
            }
        }
    };
    const stallMachine = PlaybackStallStateMachine.create({
        state,
        video,
        tracker,
        transitions
    });

    return { video, state, stallMachine };
};

describe('PlaybackStallStateMachine', () => {
    it('moves to stalled on waiting when not paused', () => {
        const { video, state, stallMachine } = createHarness();
        defineVideoProps(video, { paused: false });

        stallMachine.handleMediaEvent('waiting', { paused: video.paused });

        expect(state.state).toBe(MonitorStates.STALLED);
        expect(state.lastStallEventTime).toBeGreaterThan(0);
    });

    it('treats pause with buffer exhausted as stalled', () => {
        const { video, state, stallMachine } = createHarness();
        defineVideoProps(video, { paused: true });

        stallMachine.handleMediaEvent('pause', { bufferExhausted: true, ended: false });

        expect(state.state).toBe(MonitorStates.STALLED);
        expect(state.pauseFromStall).toBe(true);
    });

    it('treats pause without exhaustion as paused', () => {
        const { video, state, stallMachine } = createHarness();
        defineVideoProps(video, { paused: true });
        const before = state.lastStallEventTime;

        stallMachine.handleMediaEvent('pause', { bufferExhausted: false, ended: false });

        expect(state.state).toBe(MonitorStates.PAUSED);
        expect(state.lastStallEventTime).toBe(before);
    });

    it('watchdog pause without stall marks paused and returns early', () => {
        const { video, state, stallMachine } = createHarness();
        defineVideoProps(video, { paused: true });

        const result = stallMachine.handleWatchdogPause(false, false);

        expect(state.state).toBe(MonitorStates.PAUSED);
        expect(result.shouldReturn).toBe(true);
    });

    it('watchdog no-progress marks stalled', () => {
        const { state, stallMachine } = createHarness();

        stallMachine.handleWatchdogNoProgress();

        expect(state.state).toBe(MonitorStates.STALLED);
    });
});
