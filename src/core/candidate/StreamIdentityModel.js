// @module StreamIdentityModel
// --- StreamIdentityModel ---
/**
 * Tracks stream-origin continuity signals so candidate scoring can favor
 * candidates that look like the same stream lineage.
 */
const StreamIdentityModel = (() => {
    const create = (options = {}) => {
        const monitorsById = options.monitorsById;
        const isFallbackSource = options.isFallbackSource || (() => false);
        const windowMs = CONFIG.monitoring.STREAM_IDENTITY_WINDOW_MS;
        const matchBonus = CONFIG.monitoring.STREAM_IDENTITY_MATCH_BONUS;
        const recentActiveBonus = CONFIG.monitoring.STREAM_IDENTITY_RECENT_ACTIVE_BONUS;
        const originIdBonus = CONFIG.monitoring.STREAM_IDENTITY_ORIGIN_ID_BONUS;
        const recentProgressMaxMs = CONFIG.monitoring.PROGRESS_STALE_MS;

        const state = {
            originVideoId: null,
            originSignature: null,
            originUpdatedAt: 0,
            recentActives: new Map()
        };

        const normalizeSignature = (src) => {
            if (!src || typeof src !== 'string') return null;
            const trimmed = src.trim();
            if (!trimmed || trimmed.startsWith('blob:')) return null;
            try {
                const parsed = new URL(trimmed, window.location?.href || undefined);
                return `${parsed.origin}${parsed.pathname}`.toLowerCase();
            } catch (error) {
                return trimmed.split('?')[0].toLowerCase();
            }
        };

        const prune = (now, activeId = null) => {
            for (const [videoId, record] of state.recentActives.entries()) {
                if (videoId === activeId) continue;
                if ((now - record.updatedAt) > windowMs) {
                    state.recentActives.delete(videoId);
                }
            }
            if (state.originUpdatedAt && (now - state.originUpdatedAt) > windowMs) {
                state.originVideoId = null;
                state.originSignature = null;
                state.originUpdatedAt = 0;
            }
        };

        const readActiveEntry = (videoId) => {
            if (!videoId) return null;
            const entry = monitorsById?.get(videoId);
            if (!entry?.video || !entry?.monitor?.state) return null;
            const videoState = VideoState.getLite(entry.video, videoId);
            const monitorState = entry.monitor.state;
            return { videoState, monitorState };
        };

        const observeActive = (activeId, reason = 'observe') => {
            const now = Date.now();
            prune(now, activeId);
            const active = readActiveEntry(activeId);
            if (!active) return;

            const src = active.videoState.currentSrc || active.videoState.src || '';
            const signature = normalizeSignature(src);
            const hasRecentProgress = Boolean(
                active.monitorState.hasProgress
                && active.monitorState.lastProgressTime
                && (now - active.monitorState.lastProgressTime) <= recentProgressMaxMs
            );
            state.recentActives.set(activeId, {
                updatedAt: now,
                signature,
                reason,
                hadRecentProgress: hasRecentProgress
            });

            if (!hasRecentProgress || isFallbackSource(src)) {
                return;
            }
            state.originVideoId = activeId;
            state.originUpdatedAt = now;
            if (signature) {
                state.originSignature = signature;
            }
        };

        const scoreCandidate = (videoId, videoState, monitorState, activeId = null) => {
            const now = Date.now();
            prune(now);
            if (activeId && videoId === activeId) {
                return {
                    identityScore: 0,
                    identityReasons: []
                };
            }
            const src = videoState?.currentSrc || videoState?.src || '';
            const signature = normalizeSignature(src);
            const identityReasons = [];
            let identityScore = 0;

            if (state.originVideoId && state.originVideoId === videoId) {
                identityScore += originIdBonus;
                identityReasons.push('identity_origin_video');
            }
            if (state.originSignature && signature && state.originSignature === signature) {
                identityScore += matchBonus;
                identityReasons.push('identity_origin_src_match');
            }
            const recentRecord = state.recentActives.get(videoId);
            const hasRecentRecord = Boolean(recentRecord && (now - recentRecord.updatedAt) <= windowMs);
            const hasRecentProgress = Boolean(
                monitorState?.hasProgress
                && monitorState?.lastProgressTime
                && (now - monitorState.lastProgressTime) <= recentProgressMaxMs
            );
            if (hasRecentRecord && (hasRecentProgress || recentRecord.hadRecentProgress)) {
                identityScore += recentActiveBonus;
                identityReasons.push('identity_recent_active');
            }

            return {
                identityScore,
                identityReasons
            };
        };

        const getSnapshot = () => ({
            originVideoId: state.originVideoId,
            originSignature: state.originSignature,
            originUpdatedAt: state.originUpdatedAt
        });

        return {
            observeActive,
            scoreCandidate,
            getSnapshot
        };
    };

    return { create };
})();
