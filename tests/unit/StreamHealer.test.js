import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('StreamHealer', () => {
    let video;

    beforeEach(() => {
        video = document.createElement('video');
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(video, 'buffered', {
            value: { length: 0, start: () => 0, end: () => 0 },
            configurable: true
        });

        document.querySelector = vi.fn().mockReturnValue(video);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('is defined globally', () => {
        expect(window.StreamHealer).toBeDefined();
    });

    it('has monitor method', () => {
        expect(typeof window.StreamHealer.monitor).toBe('function');
    });

    it('has stopMonitoring method', () => {
        expect(typeof window.StreamHealer.stopMonitoring).toBe('function');
    });

    it('has onStallDetected method', () => {
        expect(typeof window.StreamHealer.onStallDetected).toBe('function');
    });

    it('has attemptHeal method', () => {
        expect(typeof window.StreamHealer.attemptHeal).toBe('function');
    });

    it('has getStats method', () => {
        expect(typeof window.StreamHealer.getStats).toBe('function');
    });

    it('getStats returns expected shape', () => {
        const stats = window.StreamHealer.getStats();
        expect(stats).toHaveProperty('healAttempts');
        expect(stats).toHaveProperty('isHealing');
        expect(stats).toHaveProperty('monitoredCount');
    });
});
