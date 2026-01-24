// --- BuildInfo ---
/**
 * Build metadata helpers (version injected at build time).
 */
const BuildInfo = (() => {
    const VERSION = '__BUILD_VERSION__';

    const getVersion = () => {
        const gmVersion = (typeof GM_info !== 'undefined' && GM_info?.script?.version)
            ? GM_info.script.version
            : null;
        if (gmVersion) return gmVersion;
        const unsafeVersion = (typeof unsafeWindow !== 'undefined' && unsafeWindow?.GM_info?.script?.version)
            ? unsafeWindow.GM_info.script.version
            : null;
        if (unsafeVersion) return unsafeVersion;
        if (VERSION && VERSION !== '__BUILD_VERSION__') return VERSION;
        return null;
    };

    const getVersionLine = () => {
        const version = getVersion();
        return version ? `Version: ${version}\n` : '';
    };

    return {
        VERSION,
        getVersion,
        getVersionLine
    };
})();
