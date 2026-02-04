import { describe, it, expect, vi } from 'vitest';
import { createVideo } from '../helpers/video.js';

describe('EmergencyCandidatePicker', () => {
    it('rejects unready or missing-src candidates and switches once requirements are met', () => {
        const videoA = createVideo({ currentSrc: 'blob:active', readyState: 3 });
        const videoB = createVideo({ currentSrc: '', readyState: 0 });

        const monitorsById = new Map([
            ['video-1', { video: videoA, monitor: { state: {} } }],
            ['video-2', { video: videoB, monitor: { state: {} } }]
        ]);

        const setActiveId = vi.fn();
        const scoreById = {
            'video-1': {
                score: 1,
                progressEligible: true,
                progressAgoMs: 0,
                reasons: [],
                vs: { readyState: 3, currentSrc: 'blob:active' }
            },
            'video-2': {
                score: 10,
                progressEligible: true,
                progressAgoMs: 0,
                reasons: [],
                vs: { readyState: CONFIG.stall.NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE - 1, currentSrc: 'blob:alt' }
            }
        };

        const picker = window.EmergencyCandidatePicker.create({
            monitorsById,
            scoreVideo: (video, monitor, videoId) => scoreById[videoId],
            getActiveId: () => 'video-1',
            setActiveId
        });

        let result = picker.selectEmergencyCandidate('no_heal_point');
        expect(result).toBeNull();
        expect(setActiveId).not.toHaveBeenCalled();

        scoreById['video-2'] = {
            ...scoreById['video-2'],
            vs: {
                readyState: CONFIG.stall.NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE,
                currentSrc: ''
            }
        };

        result = picker.selectEmergencyCandidate('no_heal_point');
        expect(result).toBeNull();
        expect(setActiveId).not.toHaveBeenCalled();

        scoreById['video-2'] = {
            ...scoreById['video-2'],
            vs: {
                readyState: CONFIG.stall.NO_HEAL_POINT_EMERGENCY_MIN_READY_STATE,
                currentSrc: 'blob:alt'
            }
        };

        result = picker.selectEmergencyCandidate('no_heal_point');
        expect(result?.id).toBe('video-2');
        expect(setActiveId).toHaveBeenCalledTimes(1);
        expect(setActiveId).toHaveBeenCalledWith('video-2');
    });
});
