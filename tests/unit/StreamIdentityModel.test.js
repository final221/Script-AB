import { describe, it, expect, vi } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('StreamIdentityModel', () => {
    it('adds src-match identity bonus against the observed stream origin', () => {
        vi.useFakeTimers();
        vi.setSystemTime(100000);
        const now = Date.now();
        const monitorsById = new Map([
            ['video-1', {
                video: createVideo({
                    currentSrc: 'https://usher.ttvnw.net/api/channel/hls/foo.m3u8?token=a'
                }),
                monitor: {
                    state: {
                        hasProgress: true,
                        lastProgressTime: now - 50
                    }
                }
            }]
        ]);
        const model = window.StreamIdentityModel.create({
            monitorsById,
            isFallbackSource: () => false
        });

        model.observeActive('video-1', 'test');
        const identity = model.scoreCandidate('video-2', {
            currentSrc: 'https://usher.ttvnw.net/api/channel/hls/foo.m3u8?token=b'
        }, {
            hasProgress: true,
            lastProgressTime: now - 100
        });

        expect(identity.identityScore).toBeGreaterThanOrEqual(CONFIG.monitoring.STREAM_IDENTITY_MATCH_BONUS);
        expect(identity.identityReasons).toContain('identity_origin_src_match');
        vi.useRealTimers();
    });

    it('does not adopt fallback sources as stream origin', () => {
        vi.useFakeTimers();
        vi.setSystemTime(200000);
        const now = Date.now();
        const monitorsById = new Map([
            ['video-1', {
                video: createVideo({
                    currentSrc: 'https://vod-secure.twitch.tv/_404/404_processing_640x360.png'
                }),
                monitor: {
                    state: {
                        hasProgress: true,
                        lastProgressTime: now - 50
                    }
                }
            }]
        ]);
        const model = window.StreamIdentityModel.create({
            monitorsById,
            isFallbackSource: (src) => src.includes('/_404/')
        });

        model.observeActive('video-1', 'test');
        const identity = model.scoreCandidate('video-2', {
            currentSrc: 'https://vod-secure.twitch.tv/_404/404_processing_640x360.png'
        }, {
            hasProgress: true,
            lastProgressTime: now - 100
        });

        expect(identity.identityReasons).not.toContain('identity_origin_src_match');
        vi.useRealTimers();
    });

    it('adds recent-active bonus for candidates that were active and still progressing', () => {
        vi.useFakeTimers();
        vi.setSystemTime(300000);
        const now = Date.now();
        const monitorsById = new Map([
            ['video-3', {
                video: createVideo({
                    currentSrc: 'blob:https://www.twitch.tv/abc'
                }),
                monitor: {
                    state: {
                        hasProgress: true,
                        lastProgressTime: now - 100
                    }
                }
            }]
        ]);
        const model = window.StreamIdentityModel.create({
            monitorsById,
            isFallbackSource: () => false
        });

        model.observeActive('video-3', 'test');
        const identity = model.scoreCandidate('video-3', {
            currentSrc: 'blob:https://www.twitch.tv/abc'
        }, {
            hasProgress: true,
            lastProgressTime: now - 120
        });

        expect(identity.identityScore).toBeGreaterThanOrEqual(
            CONFIG.monitoring.STREAM_IDENTITY_RECENT_ACTIVE_BONUS + CONFIG.monitoring.STREAM_IDENTITY_ORIGIN_ID_BONUS
        );
        expect(identity.identityReasons).toContain('identity_recent_active');
        expect(identity.identityReasons).toContain('identity_origin_video');
        vi.useRealTimers();
    });

    it('builds a continuity snapshot with origin and element identity details', () => {
        vi.useFakeTimers();
        vi.setSystemTime(400000);
        const now = Date.now();
        const monitorsById = new Map([
            ['video-1', {
                elementId: 11,
                video: createVideo({
                    currentTime: 5433.745,
                    currentSrc: 'https://usher.ttvnw.net/api/channel/hls/foo.m3u8?token=origin',
                    readyState: 4,
                    paused: false
                }),
                monitor: {
                    state: {
                        hasProgress: true,
                        lastProgressTime: now - 100,
                        progressEligible: true
                    }
                }
            }],
            ['video-5', {
                elementId: 12,
                video: createVideo({
                    currentTime: 4.064,
                    currentSrc: 'blob:https://www.twitch.tv/ad',
                    readyState: 2,
                    paused: true
                }),
                monitor: {
                    state: {
                        hasProgress: true,
                        lastProgressTime: now - (CONFIG.monitoring.PROGRESS_STALE_MS + 1000),
                        progressEligible: false
                    }
                }
            }]
        ]);
        const model = window.StreamIdentityModel.create({
            monitorsById,
            isFallbackSource: () => false
        });

        model.observeActive('video-1', 'test');
        model.observeActive('video-5', 'alt_seen');
        const snapshot = model.buildContinuitySnapshot({
            activeId: 'video-1',
            preferredId: 'video-5',
            current: {
                id: 'video-1',
                vs: { currentTime: '5433.745', paused: false, readyState: 4, currentSrc: 'https://usher.ttvnw.net/api/channel/hls/foo.m3u8?token=origin' },
                progressAgoMs: 100,
                progressEligible: true,
                trusted: false,
                trustReason: 'progress_ineligible',
                identityScore: 1,
                reasons: ['identity_origin_video']
            },
            preferred: {
                id: 'video-5',
                vs: { currentTime: '4.064', paused: true, readyState: 2, currentSrc: 'blob:https://www.twitch.tv/ad' },
                progressAgoMs: 2500,
                progressEligible: false,
                trusted: false,
                trustReason: 'progress_ineligible',
                identityScore: 2,
                reasons: ['identity_recent_active']
            }
        });

        expect(snapshot.originVideoId).toBe('video-1');
        expect(snapshot.originElementId).toBe(11);
        expect(snapshot.active.matchesOriginVideo).toBe(true);
        expect(snapshot.preferred.matchesOriginVideo).toBe(false);
        expect(snapshot.preferred.elementId).toBe(12);
        expect(snapshot.preferred.identityReasons).toContain('identity_recent_active');
        vi.useRealTimers();
    });
});
