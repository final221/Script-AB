// @module RefreshCoordinator
// @depends MonitorRegistry
/**
 * Executes refresh plans and keeps page-vs-element refresh policy in one place.
 */
const RefreshCoordinator = (() => {
    const AUTO_REFRESH_STORAGE_KEY = 'twad_auto_refresh_at';

    const create = (options = {}) => {
        const monitorRegistry = options.monitorRegistry;
        const candidateSelector = options.candidateSelector;
        const logDebug = options.logDebug || (() => {});
        const scanForVideos = options.scanForVideos || (() => null);

        const monitorsById = monitorRegistry.monitorsById;

        const readAutoRefreshStamp = () => {
            try {
                return Number(sessionStorage.getItem(AUTO_REFRESH_STORAGE_KEY) || 0);
            } catch (error) {
                return 0;
            }
        };

        const writeAutoRefreshStamp = (now) => {
            try {
                sessionStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(now));
            } catch (error) {
                // ignore storage failures
            }
        };

        const getExportLogsFn = () => {
            if (typeof globalThis !== 'undefined' && typeof globalThis.exportTwitchAdLogs === 'function') {
                return globalThis.exportTwitchAdLogs;
            }
            if (typeof window !== 'undefined'
                && window.top
                && typeof window.top.exportTwitchAdLogs === 'function') {
                return window.top.exportTwitchAdLogs;
            }
            return null;
        };

        const attemptLogExport = () => {
            const exportFn = getExportLogsFn();
            if (!exportFn) {
                return { ok: false, reason: 'missing_export' };
            }
            try {
                exportFn();
                return { ok: true };
            } catch (error) {
                Logger.add(LogEvents.tagged('ERROR', 'Auto refresh log export failed'), {
                    error: error?.message
                });
                return { ok: false, reason: 'exception' };
            }
        };

        const evaluatePlan = (detail = {}, now = Date.now()) => {
            const forcePageRefresh = Boolean(detail?.forcePageRefresh);
            if (!forcePageRefresh && !CONFIG.stall.AUTO_PAGE_REFRESH) {
                return {
                    mode: 'element',
                    reason: 'disabled',
                    forcePageRefresh
                };
            }
            const lastRefreshAt = readAutoRefreshStamp();
            if (lastRefreshAt) {
                const elapsedMs = now - lastRefreshAt;
                if (elapsedMs < CONFIG.stall.REFRESH_COOLDOWN_MS) {
                    return {
                        mode: 'element',
                        reason: 'cooldown',
                        remainingMs: CONFIG.stall.REFRESH_COOLDOWN_MS - elapsedMs,
                        forcePageRefresh
                    };
                }
            }
            return {
                mode: 'page',
                reason: forcePageRefresh ? 'forced' : 'auto',
                forcePageRefresh
            };
        };

        const shouldForceRefreshTakeover = (detail, preferred) => {
            if (detail?.reason !== 'processing_asset_exhausted') return false;
            if (!preferred?.id) return false;
            const readyState = preferred.vs?.readyState ?? 0;
            const hasSource = Boolean(preferred.vs?.currentSrc || preferred.vs?.src);
            return readyState >= CONFIG.monitoring.PROBATION_READY_STATE || hasSource;
        };

        const executePageRefresh = (videoId, elementId, detail, now, plan) => {
            const exportResult = attemptLogExport();
            Logger.add(LogEvents.tagged('REFRESH', 'Auto page refresh scheduled'), {
                videoId,
                elementId,
                detail,
                forced: plan.forcePageRefresh,
                exportOk: exportResult.ok,
                exportReason: exportResult.reason || null,
                delayMs: CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS
            });
            writeAutoRefreshStamp(now);
            setTimeout(() => {
                window.location.reload();
            }, CONFIG.stall.AUTO_PAGE_REFRESH_DELAY_MS);
            return true;
        };

        const executeElementRefresh = (videoId, video, elementId, detail, plan) => {
            if (plan.reason === 'cooldown') {
                logDebug(LogEvents.tagged('REFRESH', 'Auto page refresh suppressed (cooldown)'), {
                    videoId,
                    elementId,
                    remainingMs: plan.remainingMs,
                    detail
                });
            }
            Logger.add(LogEvents.tagged('REFRESH', 'Refreshing video to escape stale state'), {
                videoId,
                elementId,
                detail
            });
            monitorRegistry.stopMonitoring(video);
            monitorRegistry.resetVideoId(video);
            setTimeout(() => {
                const scanResult = scanForVideos('refresh', {
                    videoId,
                    ...detail
                });
                if (!shouldForceRefreshTakeover(detail, scanResult?.preferred)) {
                    return;
                }
                candidateSelector.forceSwitch?.(scanResult.preferred, {
                    reason: 'refresh_replacement',
                    requireProgressEligible: false,
                    requireSevere: false,
                    label: 'Forced switch to refreshed candidate',
                    suppressionLabel: 'Refreshed candidate switch suppressed'
                });
            }, 100);
            return true;
        };

        const refreshVideo = (videoId, detail = {}) => {
            const entry = monitorsById.get(videoId);
            if (!entry) return false;
            const { video } = entry;
            const elementId = typeof monitorRegistry.getElementId === 'function'
                ? monitorRegistry.getElementId(video)
                : null;
            const now = Date.now();
            const plan = evaluatePlan(detail, now);
            if (plan.mode === 'page') {
                return executePageRefresh(videoId, elementId, detail, now, plan);
            }
            return executeElementRefresh(videoId, video, elementId, detail, plan);
        };

        return {
            evaluatePlan,
            refreshVideo
        };
    };

    return { create };
})();
