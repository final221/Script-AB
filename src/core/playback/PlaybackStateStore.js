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
        state.noHealPointQuietUntil = 0;
        return true;
    };

    const setNoHealPointCount = (state, count) => {
        if (!state) return false;
        state.noHealPointCount = count;
        if (count === 0) {
            state.noHealPointQuietUntil = 0;
        }
        return true;
    };

    const setNoHealPointBackoff = (state, count, nextAllowedTime) => {
        if (!state) return false;
        state.noHealPointCount = count;
        state.nextHealAllowedTime = nextAllowedTime;
        return true;
    };

    const setNoHealPointRefreshUntil = (state, until) => {
        if (!state) return false;
        state.noHealPointRefreshUntil = until;
        return true;
    };

    const setNoHealPointQuiet = (state, until) => {
        if (!state) return false;
        state.noHealPointQuietUntil = until;
        if (until && (!state.nextHealAllowedTime || state.nextHealAllowedTime < until)) {
            state.nextHealAllowedTime = until;
        }
        return true;
    };

    const markRefresh = (state, now) => {
        if (!state) return false;
        state.lastRefreshAt = now;
        return true;
    };

    const markEmergencySwitch = (state, now) => {
        if (!state) return false;
        state.lastEmergencySwitchAt = now;
        return true;
    };

    const markBackoffLog = (state, now) => {
        if (!state) return false;
        state.lastBackoffLogTime = now;
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

    const setPlayErrorBackoff = (state, count, nextAllowedTime, now) => {
        if (!state) return false;
        state.playErrorCount = count;
        state.lastPlayErrorTime = now;
        state.nextPlayHealAllowedTime = nextAllowedTime;
        return true;
    };

    const markPlayBackoffLog = (state, now) => {
        if (!state) return false;
        state.lastPlayBackoffLogTime = now;
        return true;
    };

    const markHealAttempt = (state, now) => {
        if (!state) return false;
        state.lastHealAttemptTime = now;
        return true;
    };

    const updateHealPointRepeat = (state, point, succeeded) => {
        if (!state) return 0;
        if (succeeded || !point) {
            state.lastHealPointKey = null;
            state.healPointRepeatCount = 0;
            return 0;
        }
        const key = `${point.start.toFixed(2)}-${point.end.toFixed(2)}`;
        if (state.lastHealPointKey === key) {
            state.healPointRepeatCount = (state.healPointRepeatCount || 0) + 1;
        } else {
            state.lastHealPointKey = key;
            state.healPointRepeatCount = 1;
        }
        return state.healPointRepeatCount;
    };

    return {
        create,
        applyAliases,
        setState,
        resetNoHealPointState,
        setNoHealPointCount,
        setNoHealPointBackoff,
        setNoHealPointRefreshUntil,
        setNoHealPointQuiet,
        markRefresh,
        markEmergencySwitch,
        markBackoffLog,
        resetPlayErrorState,
        setPlayErrorBackoff,
        markPlayBackoffLog,
        markHealAttempt,
        updateHealPointRepeat
    };
})();
