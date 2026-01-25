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

    return {
        create,
        applyAliases
    };
})();
