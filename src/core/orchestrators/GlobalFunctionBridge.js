// @module GlobalFunctionBridge
// @depends Logger
/**
 * Exposes debugging functions across window/global/userscript bridge targets.
 */
const GlobalFunctionBridge = (() => {
    const getTargets = () => {
        const targets = [];

        if (typeof globalThis !== 'undefined') {
            targets.push(globalThis);
        }
        if (typeof window !== 'undefined' && window !== globalThis) {
            targets.push(window);
        }
        if (typeof unsafeWindow !== 'undefined') {
            targets.push(unsafeWindow);
        }

        return Array.from(new Set(targets));
    };

    const assignToTargets = (targets, name, fn) => {
        targets.forEach((target) => {
            try {
                target[name] = fn;
            } catch (error) {
                Logger?.add?.('[CORE] Failed to expose global target', {
                    name,
                    error: error?.message
                });
            }
        });
    };

    const exportToTargets = (targets, name, fn) => {
        if (typeof exportFunction === 'function') {
            targets.forEach((target) => {
                const rawTarget = target?.wrappedJSObject || target;
                try {
                    exportFunction(fn, rawTarget, { defineAs: name });
                } catch (error) {
                    Logger?.add?.('[CORE] Failed to export function', {
                        name,
                        error: error?.message
                    });
                }
            });
            return;
        }

        targets.forEach((target) => {
            if (!target?.wrappedJSObject) return;
            try {
                target.wrappedJSObject[name] = fn;
            } catch (error) {
                Logger?.add?.('[CORE] Failed to expose wrapped global', {
                    name,
                    error: error?.message
                });
            }
        });
    };

    const expose = (name, fn) => {
        const targets = getTargets();
        assignToTargets(targets, name, fn);
        exportToTargets(targets, name, fn);
    };

    return { expose };
})();
