// @module FormerStreamTracker
// @depends EmergencyCandidatePicker
// --- FormerStreamTracker ---
/**
 * Tracks previously active stream candidates and logs their post-switch status.
 */
const FormerStreamTracker = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const scoreVideo = options.scoreVideo;
        const maxTracked = Number.isFinite(options.maxTracked) ? options.maxTracked : 12;
        const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 120000;
        const logIntervalMs = Number.isFinite(options.logIntervalMs)
            ? options.logIntervalMs
            : CONFIG.logging.ACTIVE_LOG_MS;
        const records = new Map();

        const trimRecords = (now, activeId) => {
            for (const [videoId, record] of records.entries()) {
                if (videoId === activeId) {
                    records.delete(videoId);
                    continue;
                }
                if ((now - record.switchedAt) > ttlMs) {
                    records.delete(videoId);
                }
            }

            if (records.size <= maxTracked) {
                return;
            }

            const oldestFirst = Array.from(records.entries())
                .sort((a, b) => a[1].switchedAt - b[1].switchedAt);
            const removeCount = records.size - maxTracked;
            for (let i = 0; i < removeCount; i += 1) {
                records.delete(oldestFirst[i][0]);
            }
        };

        const buildStatus = (videoId, record, now) => {
            const entry = monitorsById.get(videoId);
            if (!entry) {
                return {
                    status: 'removed',
                    terminal: true
                };
            }

            const video = entry.video;
            const monitorState = entry.monitor?.state || {};
            const currentTime = Number.isFinite(video?.currentTime) ? Number(video.currentTime.toFixed(3)) : null;
            const readyState = video?.readyState ?? null;
            const paused = Boolean(video?.paused);
            const hasSrc = Boolean(
                video?.currentSrc
                || video?.getAttribute?.('src')
            );
            const progressSinceSwitch = Boolean(
                monitorState.hasProgress
                && monitorState.lastProgressTime
                && monitorState.lastProgressTime > Math.max(record.switchedAt, record.baselineProgressTime || 0)
            );
            const lastProgressAgoMs = monitorState.lastProgressTime
                ? Math.max(now - monitorState.lastProgressTime, 0)
                : null;
            const currentTimeDelta = (
                Number.isFinite(currentTime)
                && Number.isFinite(record.baselineCurrentTime)
            )
                ? Number((currentTime - record.baselineCurrentTime).toFixed(3))
                : null;
            const score = typeof scoreVideo === 'function'
                ? scoreVideo(video, entry.monitor, videoId)?.score ?? null
                : null;

            let status = 'no_progress';
            if (progressSinceSwitch || (Number.isFinite(currentTimeDelta) && currentTimeDelta > 0.05)) {
                status = 'progressed_after_switch';
            } else if (!hasSrc && (readyState === 0 || readyState === 1)) {
                status = 'no_source';
            } else if (paused) {
                status = 'paused_no_progress';
            }

            return {
                status,
                terminal: status === 'progressed_after_switch',
                currentTime,
                currentTimeDelta,
                readyState,
                paused,
                hasSrc,
                monitorState: monitorState.state || null,
                progressSinceSwitch,
                lastProgressAgoMs,
                score
            };
        };

        const trackSwitch = ({ fromId, toId, reason }) => {
            if (!fromId || fromId === toId) {
                return;
            }
            const now = Date.now();
            const entry = monitorsById.get(fromId);
            const baselineCurrentTime = Number.isFinite(entry?.video?.currentTime)
                ? Number(entry.video.currentTime.toFixed(3))
                : null;
            const baselineProgressTime = entry?.monitor?.state?.lastProgressTime || 0;
            records.set(fromId, {
                fromId,
                toId: toId || null,
                reason: reason || 'switch',
                switchedAt: now,
                baselineCurrentTime,
                baselineProgressTime,
                lastLoggedAt: 0,
                lastStatus: null
            });
            if (toId) {
                records.delete(toId);
            }
            trimRecords(now, toId || null);
        };

        const onActive = (activeId) => {
            if (!activeId) return;
            records.delete(activeId);
        };

        const observe = ({ reason, activeId } = {}) => {
            const now = Date.now();
            trimRecords(now, activeId || null);
            for (const [videoId, record] of records.entries()) {
                const elapsedSinceLog = now - (record.lastLoggedAt || 0);
                if (elapsedSinceLog < logIntervalMs) {
                    continue;
                }
                const snapshot = buildStatus(videoId, record, now);
                const statusChanged = snapshot.status !== record.lastStatus;
                if (!statusChanged && elapsedSinceLog < (logIntervalMs * 3)) {
                    continue;
                }

                Logger.add(LogEvents.tagged('CANDIDATE', 'Former stream candidate status'), {
                    formerVideoId: videoId,
                    switchedTo: record.toId,
                    switchReason: record.reason,
                    observeReason: reason || null,
                    status: snapshot.status,
                    ageMs: now - record.switchedAt,
                    currentTime: snapshot.currentTime ?? null,
                    currentTimeDelta: snapshot.currentTimeDelta ?? null,
                    readyState: snapshot.readyState ?? null,
                    paused: snapshot.paused ?? null,
                    hasSrc: snapshot.hasSrc ?? null,
                    monitorState: snapshot.monitorState ?? null,
                    progressSinceSwitch: snapshot.progressSinceSwitch ?? false,
                    lastProgressAgoMs: snapshot.lastProgressAgoMs ?? null,
                    score: snapshot.score
                });

                record.lastLoggedAt = now;
                record.lastStatus = snapshot.status;

                if (snapshot.terminal) {
                    records.delete(videoId);
                }
            }
        };

        return {
            trackSwitch,
            onActive,
            observe
        };
    };

    return { create };
})();
