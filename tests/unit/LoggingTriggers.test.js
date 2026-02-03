import { describe, it, expect, vi, afterEach } from 'vitest';
import { createVideo, defineVideoProps } from '../helpers/video.js';

describe('Logging triggers', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = '';
    });

    it('logs refresh when explicit refresh is requested', () => {
        const monitoring = MonitoringOrchestrator.create({
            logDebug: () => {},
            isHealing: () => false,
            isFallbackSource: () => false
        });

        const video = createVideo({ paused: false, readyState: 4, networkState: 2, currentSrc: 'src-main' });
        document.body.appendChild(video);

        monitoring.monitor(video);

        const initialLogs = Logger.getLogs().length;
        const videoId = monitoring.getVideoId(video);
        const entry = monitoring.monitorsById.get(videoId);

        const refreshed = monitoring.recoveryManager.requestRefresh(video, entry.monitor.state, {
            reason: 'manual',
            trigger: 'test'
        });

        expect(refreshed).toBe(true);

        const logs = Logger.getLogs().slice(initialLogs);
        const refreshLog = logs.find(log => log.message === LogTags.TAG.REFRESH);
        expect(refreshLog).toBeDefined();
        expect(refreshLog.detail.reason).toBe('manual');

        monitoring.stopMonitoring(video);
    });

    it('logs reset when hard reset callback fires', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);

        const monitoring = MonitoringOrchestrator.create({
            logDebug: () => {},
            isHealing: () => false,
            isFallbackSource: () => false
        });

        const video = createVideo({ paused: false, readyState: 4, currentSrc: 'src-main' });
        document.body.appendChild(video);
        monitoring.monitor(video);

        const initialLogs = Logger.getLogs().length;

        defineVideoProps(video, { readyState: 0, networkState: 0, src: '' });
        Object.defineProperty(video, 'currentSrc', { configurable: true, get: () => '' });
        video.getAttribute = vi.fn().mockImplementation(() => '');

        video.dispatchEvent(new Event('emptied'));

        const videoId = monitoring.getVideoId(video);
        const entry = monitoring.monitorsById.get(videoId);
        const pendingForMs = CONFIG.stall.RESET_GRACE_MS + 1;

        expect(typeof entry.monitor.state.resetPendingCallback).toBe('function');
        entry.monitor.state.resetPendingAt = Date.now() - pendingForMs;
        entry.monitor.state.resetPendingCallback({
            reason: 'emptied',
            resetType: entry.monitor.state.resetPendingType,
            pendingForMs,
            videoState: VideoState.get(video, videoId)
        }, entry.monitor.state);

        const logs = Logger.getLogs().slice(initialLogs);
        const resetLog = logs.find(log => log.message === LogTags.TAG.RESET);
        expect(resetLog).toBeDefined();
        expect(resetLog.detail.videoId).toBe(videoId);

        monitoring.stopMonitoring(video);
    });

    it('logs candidate suppression when score delta is too small', () => {
        const initialLogs = Logger.getLogs().length;
        const logDebug = LogDebug.create();
        const policy = CandidateSwitchPolicy.create({
            switchDelta: CONFIG.monitoring.CANDIDATE_SWITCH_DELTA,
            minProgressMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
            logDebug
        });

        policy.decide({
            now: 1000,
            current: {
                id: 'video-1',
                score: 5,
                reasons: [],
                state: MonitorStates.STALLED,
                monitorState: { lastProgressTime: 0 },
                trusted: false
            },
            preferred: {
                id: 'video-2',
                score: 5 + (CONFIG.monitoring.CANDIDATE_SWITCH_DELTA - 1),
                progressEligible: true,
                progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                trusted: true,
                vs: { readyState: 3, currentSrc: 'blob:stream' },
                reasons: []
            },
            activeCandidateId: 'video-1',
            probationActive: true,
            scores: [],
            reason: 'interval'
        });

        const logs = Logger.getLogs().slice(initialLogs);
        const suppressionLog = logs.find(log => (
            log.message === LogTags.TAG.CANDIDATE
            && log.detail?.suppression === 'score_delta'
        ));
        expect(suppressionLog).toBeDefined();
    });

    it('logs failover success when candidate progresses', () => {
        vi.useFakeTimers();
        vi.setSystemTime(CONFIG.stall.FAILOVER_COOLDOWN_MS + 1);

        const initialLogs = Logger.getLogs().length;

        const videoA = createVideo({ paused: false, readyState: 4, currentSrc: 'src-a' });
        const videoB = createVideo({ paused: false, readyState: 4, currentSrc: 'src-b' });
        videoB.play = () => Promise.resolve();

        const monitorsById = new Map([
            ['video-1', { video: videoA, monitor: { state: { lastProgressTime: 0 } } }],
            ['video-2', { video: videoB, monitor: { state: { lastProgressTime: 0, hasProgress: false } } }]
        ]);

        const candidateSelector = {
            scoreVideo: (_video, _monitor, videoId) => ({
                score: videoId === 'video-2' ? 10 : 1,
                progressEligible: true,
                reasons: [],
                vs: { currentSrc: 'blob:stream', readyState: 3 },
                progressStreakMs: CONFIG.monitoring.CANDIDATE_MIN_PROGRESS_MS,
                progressAgoMs: 0,
                deadCandidate: false
            }),
            setActiveId: vi.fn()
        };

        const failover = FailoverManager.create({
            monitorsById,
            candidateSelector,
            getVideoId: () => 'video-1',
            logDebug: () => {},
            resetBackoff: vi.fn()
        });

        const attempted = failover.attemptFailover('video-1', 'no_heal_point', monitorsById.get('video-1').monitor.state);
        expect(attempted).toBe(true);

        const monitorB = monitorsById.get('video-2').monitor;
        monitorB.state.hasProgress = true;
        monitorB.state.lastProgressTime = Date.now() + 1;

        vi.advanceTimersByTime(CONFIG.stall.FAILOVER_PROGRESS_TIMEOUT_MS + 1);

        const logs = Logger.getLogs().slice(initialLogs);
        const successLog = logs.find(log => log.message === LogTags.TAG.FAILOVER_SUCCESS);
        expect(successLog).toBeDefined();
    });
});
