import { afterEach, describe, expect, it, vi } from 'vitest';

describe('GlobalFunctionBridge', () => {
    afterEach(() => {
        delete global.exportFunction;
        delete global.unsafeWindow;
        delete window.testBridgeHook;
        delete global.testBridgeHook;
    });

    it('exposes functions to global targets and userscript bridge targets', () => {
        const fn = vi.fn();
        global.unsafeWindow = { wrappedJSObject: {} };
        global.exportFunction = vi.fn();

        window.GlobalFunctionBridge.expose('testBridgeHook', fn);

        expect(window.testBridgeHook).toBe(fn);
        expect(global.testBridgeHook).toBe(fn);
        expect(global.unsafeWindow.testBridgeHook).toBe(fn);
        expect(global.exportFunction).toHaveBeenCalledWith(
            fn,
            global.unsafeWindow.wrappedJSObject,
            { defineAs: 'testBridgeHook' }
        );
    });
});
