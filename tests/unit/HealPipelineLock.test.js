import { describe, it, expect, vi, afterEach } from 'vitest';

const createDeferred = () => {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

describe('HealPipeline locking', () => {
    let originalCreate;

    afterEach(() => {
        if (originalCreate) {
            window.HealAttemptRunner.create = originalCreate;
            originalCreate = null;
        }
    });

    it('aborts concurrent heal attempts for the same video', async () => {
        const video = document.createElement('video');
        document.body.appendChild(video);

        const deferred = createDeferred();
        originalCreate = window.HealAttemptRunner.create;
        window.HealAttemptRunner.create = () => ({
            runHealAttempt: () => deferred.promise
        });

        const recoveryManager = {
            resetBackoff: vi.fn(),
            resetPlayError: vi.fn(),
            handleNoHealPoint: vi.fn(),
            handlePlayFailure: vi.fn()
        };

        const pipeline = window.HealPipeline.create({
            getVideoId: () => 'video-1',
            logWithState: () => {},
            logDebug: () => {},
            recoveryManager,
            isActive: () => true,
            onDetached: vi.fn()
        });

        const first = pipeline.attemptHeal(video);
        const second = pipeline.attemptHeal(video);

        const secondResult = await second;
        expect(secondResult.status).toBe('aborted');
        expect(secondResult.phase).toBe('lock');
        expect(secondResult.reason).toBe('already_healing');

        deferred.resolve({ status: 'recovered', phase: 'poll' });
        const firstResult = await first;
        expect(firstResult.status).toBe('recovered');

        video.remove();
    });
});
