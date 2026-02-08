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
});
