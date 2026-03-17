import { describe, it, expect } from 'vitest';

describe('CandidateTrust', () => {
    it('rejects candidates without progress eligibility', () => {
        const info = CandidateTrust.getTrustInfo({
            progressEligible: false,
            reasons: [],
            progressAgoMs: 1000
        });
        expect(info.trusted).toBe(false);
        expect(info.reason).toBe('progress_ineligible');
    });

    it('rejects candidates with bad reasons', () => {
        const info = CandidateTrust.getTrustInfo({
            progressEligible: true,
            reasons: ['fallback_src'],
            progressAgoMs: 1000
        });
        expect(info.trusted).toBe(false);
        expect(info.reason).toBe('bad_reason');
    });

    it('rejects candidates with stale progress', () => {
        const info = CandidateTrust.getTrustInfo({
            progressEligible: true,
            reasons: [],
            progressAgoMs: CONFIG.monitoring.TRUST_STALE_MS + 1
        });
        expect(info.trusted).toBe(false);
        expect(info.reason).toBe('progress_stale');
    });

    it('accepts candidates with recent progress', () => {
        const info = CandidateTrust.getTrustInfo({
            progressEligible: true,
            reasons: [],
            progressAgoMs: 1000
        });
        expect(info.trusted).toBe(true);
        expect(info.reason).toBe('trusted');
    });

    it('rejects degraded or dead candidates even with recent progress', () => {
        const degraded = CandidateTrust.getTrustInfo({
            progressEligible: true,
            reasons: ['degraded_sync'],
            progressAgoMs: 1000
        });
        const dead = CandidateTrust.getTrustInfo({
            progressEligible: true,
            reasons: ['dead_candidate'],
            progressAgoMs: 1000
        });

        expect(degraded.trusted).toBe(false);
        expect(degraded.reason).toBe('bad_reason');
        expect(dead.trusted).toBe(false);
        expect(dead.reason).toBe('bad_reason');
    });
});
