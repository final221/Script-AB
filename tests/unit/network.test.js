import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Network Modules', () => {

    describe('AdBlocker', () => {
        it('correlation detects missed ads', () => {
            const AdBlocker = window.AdBlocker;
            if (AdBlocker.init) AdBlocker.init();

            const stats = AdBlocker.getCorrelationStats();
            expect(typeof stats.lastAdDetectionTime).toBe('number');
            expect(typeof stats.recoveryTriggersWithoutAds).toBe('number');
        });
    });

});
