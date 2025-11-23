// ============================================================================
// 3. ADAPTERS (Side-Effects)
// ============================================================================
/**
 * Side-effect wrappers for DOM, Storage, and Event handling.
 * Isolate impure operations here to keep Logic kernels pure.
 * @namespace Adapters
 */
const Adapters = {
    DOM: {
        find: (sel) => document.querySelector(sel),
        clone: (el) => el.cloneNode(true),
        replace: (oldEl, newEl) => oldEl.parentNode && oldEl.parentNode.replaceChild(newEl, oldEl),
        observe: (el, cb, opts) => {
            const obs = new MutationObserver(cb);
            obs.observe(el, opts);
            return obs;
        }
    },
    Storage: {
        read: (key) => Fn.tryCatch(() => localStorage.getItem(key))(),
        write: (key, val) => Fn.tryCatch(() => localStorage.setItem(key, JSON.stringify(val)))(),
    },
    EventBus: {
        listeners: {},
        on(event, callback) {
            if (!this.listeners[event]) this.listeners[event] = new Set();
            this.listeners[event].add(callback);
        },
        emit(event, data) {
            if (!this.listeners[event]) return;
            queueMicrotask(() => {
                this.listeners[event].forEach(cb => Fn.tryCatch(cb)(data));
            });
        }
    }
};
