import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CoreDebugHooks', () => {
    afterEach(() => {
        delete window.exportTwitchAdLogs;
        delete window.exporttwitchadlogs;
        delete window.triggerTwitchAdLastResort;
        delete window.triggertwitchadlastresort;
        Logger.getLogs().length = 0;
    });

    it('installs top-window hooks that export logs and trigger last resort on the healer', () => {
        const healer = {
            getStats: vi.fn(() => ({ active: 1 })),
            triggerLastResortRefresh: vi.fn(() => ({ ok: true }))
        };
        const exportSpy = vi.spyOn(ReportGenerator, 'exportReport').mockImplementation(() => {});
        const hooks = window.CoreDebugHooks.create({
            ensureStreamHealer: () => healer,
            isTopWindow: true
        });

        hooks.installGlobals();

        window.exportTwitchAdLogs();
        const result = window.triggerTwitchAdLastResort({ source: 'test' });

        expect(exportSpy).toHaveBeenCalledTimes(1);
        expect(healer.triggerLastResortRefresh).toHaveBeenCalledWith({ source: 'test' });
        expect(result).toEqual({ ok: true });
    });

    it('installs iframe hooks that proxy to the top window', () => {
        const topWindow = {
            exportTwitchAdLogs: vi.fn(),
            triggerTwitchAdLastResort: vi.fn(() => ({ ok: false, reason: 'top_result' }))
        };
        const hooks = window.CoreDebugHooks.create({
            ensureStreamHealer: vi.fn(),
            getTopWindow: () => topWindow,
            isTopWindow: false
        });

        hooks.installGlobals();

        window.exportTwitchAdLogs();
        const result = window.triggerTwitchAdLastResort({ source: 'iframe' });

        expect(topWindow.exportTwitchAdLogs).toHaveBeenCalledTimes(1);
        expect(topWindow.triggerTwitchAdLastResort).toHaveBeenCalledWith({ source: 'iframe' });
        expect(result).toEqual({ ok: false, reason: 'top_result' });
    });
});
