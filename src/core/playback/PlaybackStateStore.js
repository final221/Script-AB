// --- PlaybackStateStore ---
/**
 * Builds playback state objects with alias mapping.
 */
const PlaybackStateStore = (() => {
    const defineAlias = (target, key, path) => {
        Object.defineProperty(target, key, {
            configurable: true,
            get: () => path.reduce((ref, segment) => ref[segment], target),
            set: (value) => {
                let ref = target;
                for (let i = 0; i < path.length - 1; i++) {
                    ref = ref[path[i]];
                }
                ref[path[path.length - 1]] = value;
            }
        });
    };

    const applyAliases = (target, map) => {
        Object.entries(map).forEach(([key, path]) => defineAlias(target, key, path));
    };

    const create = (video) => {
        const state = PlaybackStateDefaults.create(video);
        applyAliases(state, PlaybackStateDefaults.aliasMap);

        return state;
    };

    const setState = (state, nextState, detail = {}) => {
        if (!state || state.state === nextState) return false;
        const prevState = state.state;
        state.state = nextState;
        if (typeof detail.log === 'function') {
            detail.log(prevState, nextState, detail.reason);
        }
        return true;
    };

    const resetNoHealPointState = (state) => {
        if (!state) return false;
        state.noHealPointCount = 0;
        state.nextHealAllowedTime = 0;
        state.noHealPointRefreshUntil = 0;
        return true;
    };

    const resetPlayErrorState = (state) => {
        if (!state) return false;
        state.playErrorCount = 0;
        state.nextPlayHealAllowedTime = 0;
        state.lastPlayErrorTime = 0;
        state.lastPlayBackoffLogTime = 0;
        state.lastHealPointKey = null;
        state.healPointRepeatCount = 0;
        return true;
    };

    return {
        create,
        applyAliases,
        setState,
        resetNoHealPointState,
        resetPlayErrorState
    };
})();
