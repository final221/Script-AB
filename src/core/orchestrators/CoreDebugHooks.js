// @module CoreDebugHooks
// @depends GlobalFunctionBridge, Logger, Metrics, ReportGenerator
/**
 * Installs exported debug hooks and their top-window proxies.
 */
const CoreDebugHooks = (() => {
    const getDefaultTopWindow = () => {
        try {
            return window.top;
        } catch (error) {
            Logger?.add?.('[CORE] Failed to access top window', { error: error?.message });
            return null;
        }
    };

    const create = (options = {}) => {
        const ensureStreamHealer = options.ensureStreamHealer || (() => null);
        const getTopWindow = options.getTopWindow || getDefaultTopWindow;
        const isTopWindow = Boolean(options.isTopWindow);

        const exportLogs = () => {
            try {
                const healer = ensureStreamHealer();
                const healerStats = healer?.getStats ? healer.getStats() : {};
                const metricsSummary = Metrics?.getSummary ? Metrics.getSummary() : {};
                const mergedLogs = Logger?.getMergedTimeline ? Logger.getMergedTimeline() : [];
                ReportGenerator?.exportReport?.(metricsSummary, mergedLogs, healerStats);
            } catch (error) {
                Logger?.add?.('[CORE] exportTwitchAdLogs failed', { error: error?.message });
            }
        };

        const exportLogsProxy = () => {
            try {
                const topWindow = getTopWindow();
                if (topWindow && typeof topWindow.exportTwitchAdLogs === 'function') {
                    topWindow.exportTwitchAdLogs();
                    return;
                }
            } catch (error) {
                Logger?.add?.('[CORE] exportTwitchAdLogs proxy failed', { error: error?.message });
            }
            Logger?.add?.('[CORE] exportTwitchAdLogs not available in top window');
        };

        const triggerLastResort = (options = {}) => {
            try {
                const healer = ensureStreamHealer();
                if (typeof healer?.triggerLastResortRefresh !== 'function') {
                    return { ok: false, reason: 'method_unavailable' };
                }
                return healer.triggerLastResortRefresh(options);
            } catch (error) {
                Logger?.add?.('[CORE] triggerTwitchAdLastResort failed', { error: error?.message });
                return { ok: false, reason: 'exception', error: error?.message };
            }
        };

        const triggerLastResortProxy = (options = {}) => {
            try {
                const topWindow = getTopWindow();
                if (topWindow && typeof topWindow.triggerTwitchAdLastResort === 'function') {
                    return topWindow.triggerTwitchAdLastResort(options);
                }
            } catch (error) {
                Logger?.add?.('[CORE] triggerTwitchAdLastResort proxy failed', { error: error?.message });
                return { ok: false, reason: 'proxy_failed' };
            }
            Logger?.add?.('[CORE] triggerTwitchAdLastResort not available in top window');
            return { ok: false, reason: 'proxy_missing' };
        };

        const installGlobals = () => {
            const exportFn = isTopWindow ? exportLogs : exportLogsProxy;
            const lastResortFn = isTopWindow ? triggerLastResort : triggerLastResortProxy;

            GlobalFunctionBridge.expose('exportTwitchAdLogs', exportFn);
            GlobalFunctionBridge.expose('exporttwitchadlogs', exportFn);
            GlobalFunctionBridge.expose('triggerTwitchAdLastResort', lastResortFn);
            GlobalFunctionBridge.expose('triggertwitchadlastresort', lastResortFn);
        };

        return {
            installGlobals,
            exportLogs,
            exportLogsProxy,
            triggerLastResort,
            triggerLastResortProxy
        };
    };

    return { create };
})();
